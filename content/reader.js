/*****************************************************************************
 **
 ** Gofr
 ** https://github.com/melllvar/Gofr
 ** Copyright (C) 2013 Akop Karapetyan
 **
 ** This program is free software; you can redistribute it and/or modify
 ** it under the terms of the GNU General Public License as published by
 ** the Free Software Foundation; either version 2 of the License, or
 ** (at your option) any later version.
 **
 ** This program is distributed in the hope that it will be useful,
 ** but WITHOUT ANY WARRANTY; without even the implied warranty of
 ** MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 ** GNU General Public License for more details.
 **
 ** You should have received a copy of the GNU General Public License
 ** along with this program; if not, write to the Free Software
 ** Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
 **
 ******************************************************************************
 */

$().ready(function() {
  var $dragSource = null;
  var $dragClone = null;
  var dragDestination = null;

  var clientId = null;
  var subscriptionMap = null;
  var continueFrom = null;
  var lastContinued = null;
  var lastGPressTime = 0;
  var channel;

  var linkify = function(str, args) {
    var re = /\(((?:[a-z]+:\/\/|%s)[^\)]*)\)\[([^\]]*)\]/g;
    var m;
    var start = 0;
    var html = "";
    var outArgs = [];

    while ((m = re.exec(str)) !== null) {
      var url = m[1];
      var text = m[2];
      var anchor = '<a href="' + url + '" target="_blank">%s</a>';

      html += str.substr(start, m.index - start) + anchor;
      start = m.index + m[0].length;

      outArgs.push(text);
    }

    html += str.substr(start);

    return { html: html, args: args ? args : outArgs };
  };

  var _l = function(str, args) {
    var localized = null;
    if (typeof gofrStrings !== 'undefined' && gofrStrings != null)
      localized = gofrStrings[str];

    if (localized == null)
      localized = str; // No localization

    var md = linkify(localized, args);
    localized = md.html;
    if (md.args.length)
      args = md.args;

    if (args)
      return vsprintf(localized, args);

    return localized;
  };

  var getPublishedDate = function(dateAsString) {
    var now = new Date();
    var date = new Date(dateAsString);
    
    var sameDay = now.getDate() == date.getDate() 
      && now.getMonth() == date.getMonth() 
      && now.getFullYear() == date.getFullYear();

    return dateTimeFormatter(date, sameDay);
  };

  // Automatic pager

  $('.gofr-entries-container').scroll(function() {
    var pagerHeight = $('.next-page').outerHeight();
    if (!pagerHeight)
      return; // No pager

    if (lastContinued == continueFrom)
      return;

    var offset = $('#gofr-entries').height() - ($('.gofr-entries-container').scrollTop() + $('.gofr-entries-container').height()) - pagerHeight;
    if (offset < 36)
      $('.next-page').click();
  });

  // Default click handler

  $('html')
    .click(function() {
      $('.shortcuts').hide();
      $('#floating-nav').hide();
      $$menu.hideAll();
    })
    .mouseup(function(e) {
      $('#subscriptions').unbind("mousemove");
      $('#subscriptions .dragging').remove();
      $('#subscriptions .dragged').removeClass('dragged');

      if ($dragSource && dragDestination) {
        var dragSource = $dragSource.data('subscription');
        if (dragDestination.id != (dragSource.parent || ''))
          dragSource.moveTo(dragDestination);
      }

      $dragSource = null;
      $dragClone = null;
      dragDestination = null;
    });

  $('.modal-blocker').click(function() {
    $('.modal').showModal(false);
  });

  // Default error handler

  $(document).ajaxError(function(event, jqxhr, settings, exception) {
    var errorMessage;

    try {
      var errorJson = $.parseJSON(jqxhr.responseText)
      errorMessage = errorJson.errorMessage;
    } catch (exception) {
      errorMessage = _l("An unexpected error has occurred. Please try again later.");
    }

    if (errorMessage != null)
      ui.showToast(errorMessage, true);
    else if (errorJson.infoMessage != null)
      ui.showToast(errorJson.infoMessage, false);
  });

  var subscriptionMethods = {
    'getRef': function() {
      return {
        's': this.id,
        'f': this.parent ? this.parent : undefined,
      };
    },
    'getFilter': function(filter) {
      return $.extend({}, this.getRef(), { 
        'p': filter ? filter : undefined,
      });
    },
    'getDom': function() {
      return $('#subscriptions').find('.' + this.domId);
    },
    'isFolder': function() {
      return false;
    },
    'isRoot': function() {
      return false;
    },
    'getFavIconUrl': function() {
      if (this.link)
        return '/favicon?url=' + this.link;

      return '/content/favicon-default.png';
    },
    'getChildren': function() {
      var subscription = this;
      var children = [];

      $.each(subscriptionMap, function(key, sub) {
        if (subscription.id === "" || sub.parent === subscription.id)
          children.push(sub);
      });

      return children;
    },
    'addPage': function(entries) {
      var subscription = this;
      var idCounter = $('#gofr-entries').find('.gofr-entry').length;

      $.each(entries, function() {
        var entry = this;
        var details = entry.details;

        // Inject methods
        for (var name in entryMethods)
          entry[name] = entryMethods[name];

        var entrySubscription = entry.getSubscription();
        if (!entrySubscription)
          return true; // May have been deleted on server; don't add it if so

        entry.domId = 'gofr-entry-' + idCounter++;
        var $entry = $('<div />', { 'class': 'gofr-entry ' + entry.domId})
          .data('entry', entry)
          .append($('<div />', { 'class' : 'gofr-entry-item' })
            .append($('<div />', { 'class' : 'action-star' })
              .click(function(e) {
                entry.toggleStarred();
                e.stopPropagation();
              }))
            .append($('<span />', { 'class' : 'gofr-entry-source' })
              .text(entrySubscription != null ? entrySubscription.title : null))
            .append($('<a />', { 'class' : 'gofr-entry-link', 'href' : details.link, 'target' : '_blank' })
              .click(function(e) {
                e.stopPropagation();
              }))
            .append($('<span />', { 'class' : 'gofr-entry-pubDate' })
              .text(getPublishedDate(details.published)))
            .append($('<div />', { 'class' : 'gofr-entry-excerpt' })
              .append($('<h2 />', { 'class' : 'gofr-entry-title' })
                .text(details.title))))
          .click(function() {
            entry.select();
            
            var wasExpanded = entry.isExpanded();

            ui.collapseAllEntries();
            if (!wasExpanded) {
              entry.expand();
              entry.scrollIntoView();
            }
          });

        if (details.summary) {
          $entry.find('.gofr-entry-excerpt')
            .append($('<span />', { 'class' : 'gofr-entry-spacer' }).text(' - '))
            .append($('<span />', { 'class' : 'gofr-entry-summary' }).text(details.summary));
        }

        $('#gofr-entries').append($entry);

        entry.syncView();
      });

      $('.next-page').remove();

      ui.onEntryListUpdate();

      if (continueFrom) {
        $('#gofr-entries')
          .append($('<div />', { 'class' : 'next-page' })
            .text(_l('Continue'))
            .click(function(e) {
              subscription.loadEntries();
            }));
      }
    },
    'loadEntries': function() {
      lastContinued = continueFrom;

      var subscription = this;
      var selectedFilter = $('.group-filter.selected-menu-item').data('value');

      $.getJSON('articles', {
        'filter':   JSON.stringify(subscription.getFilter(selectedFilter)),
        'continue': continueFrom ? continueFrom : undefined,
        'client':   clientId,
      })
      .success(function(response) {
        continueFrom = response.continue;
        subscription.addPage(response.articles, response.continue);
      });
    },
    'refresh': function() {
      continueFrom = null;
      lastContinued = null;

      $('#gofr-entries').empty();
      this.loadEntries();
    },
    'select': function(reloadItems /* = true */) {
      if (typeof reloadItems === 'undefined')
        reloadItems = true;

      $('#subscriptions').find('.subscription.selected').removeClass('selected');
      this.getDom().addClass('selected');

      if (reloadItems) {
        this.selectedEntry = null;

        $('#gofr-entries').toggleClass('single-source', this.link != null);

        if (!this.link)
          $('.gofr-entries-header').text(this.title);
        else
          $('.gofr-entries-header').html($('<a />', { 'href' : this.link, 'target' : '_blank' })
            .text(this.title)
            .append($('<span />')
              .text(' »')));

        this.refresh();
        ui.updateUnreadCount();
      }
    },
    'syncView': function() {
      var $feed = this.getDom();
      var $item = $feed.find('> .subscription-item');

      $item.find('.subscription-title').text(this.title);
      $item.find('.subscription-unread-count').text('(' + this.unread + ')');
      $item.toggleClass('has-unread', this.unread > 0);
      $feed.toggleClass('no-unread', this.unread < 1);

      var parent = this.getParent();
      if (parent)
        parent.syncView();

      if (!this.isRoot())
        this.getRoot().syncView();
    },
    'getType': function() {
      return 'leaf';
    },
    'getParent': function() {
      if (!this.parent)
        return null;

      return subscriptionMap[this.parent];
    },
    'getRoot': function() {
      return subscriptionMap[''];
    },
    'updateUnreadCount': function(byHowMuch) {
      this.unread += byHowMuch;

      var parent = this.getParent();
      if (parent != null)
        parent.unread += byHowMuch;

      this.getRoot().unread += byHowMuch;
    },
    'rename': function(newName) {
      var subscription = this;

      $.post('rename', {
        'ref': JSON.stringify(subscription.getRef()),
        'title': newName,
      }, 
      function(response) {
        resetSubscriptionDom(response, false);
      }, 'json');
    },
    'unsubscribe': function() {
      var subscription = this;
      if (!subscription.isFolder()) {
        $.post('unsubscribe', {
          'client': clientId,
          'subscription': subscription.id,
          'folder': subscription.parent,
        }, 
        function(response) {
          resetSubscriptionDom(response, false);
          ui.pruneDeadEntries();
        }, 'json');
      }
    },
    'markAllAsRead': function(filter) {
      var subscription = this;

      $.post('markAllAsRead', {
        'client':       clientId,
        'subscription': subscription.isFolder() ? undefined : subscription.id,
        'folder':       subscription.isFolder() ? subscription.id : subscription.parent,
        'filter':       filter,
      },
      function(response) {
        ui.showToast(response.message);
        if (response.done)
          refresh();
      }, 'json');
    },
    'moveTo': function(folder) {
      var subscription = this;

      $.post('moveSubscription', {
        'client':       clientId,
        'subscription': subscription.id,
        'folder':       subscription.parent ? subscription.parent : undefined,
        'destination':  folder.id ? folder.id : undefined,
      },
      function(response) {
        resetSubscriptionDom(response, false);
      }, 'json');
    },
    'removeFolder': function() {
      var subscription = this;
      if (subscription.isFolder()) {
        $.post('removeFolder', {
          'client': clientId,
          'folder': subscription.id,
        }, 
        function(response) {
          resetSubscriptionDom(response, false);
          ui.pruneDeadEntries();
        }, 'json');
      }
    },
  };

  var folderMethods = $.extend({}, subscriptionMethods, {
    'getRef': function() {
      return {
        'f': this.id ? this.id : undefined,
      };
    },
    'subscribe': function(url) {
      var params = {
        'url': url,
        'client': clientId,
      };
      if (this.id)
        params['folder'] = this.id;

      $.post('subscribe', params, function(response) {
        resetSubscriptionDom(response, false);
      }, 'json');
    },
    'isFolder': function() {
      return true;
    },
    'isRoot': function() {
      return this.id == "";
    },
    'getType': function() {
      if (this.isRoot())
        return 'root';

      return 'folder';
    },
  });

  var entryMethods = {
    'getSubscription': function() {
      return subscriptionMap[this.source];
    },
    'getDom': function() {
      return $('#gofr-entries').find('.' + this.domId);
    },
    'hasProperty': function(propertyName) {
      return $.inArray(propertyName, this.properties) > -1;
    },
    'setProperty': function(propertyName, propertyValue) {
      if (propertyValue == this.hasProperty(propertyName))
        return; // Already set

      var entry = this;

      $.post('setProperty', {
        'article':      this.id,
        'subscription': this.source,
        'folder':       this.getSubscription().parent,
        'property':     propertyName,
        'set':          propertyValue,
      },
      function(properties) {
        delete entry.properties;

        entry.properties = properties;
        entry.syncView();

        if (propertyName == 'read') {
          var subscription = entry.getSubscription();
          subscription.updateUnreadCount(propertyValue ? -1 : 1);

          subscription.syncView();
          ui.updateUnreadCount();
        }
      }, 'json');
    },
    'toggleStarred': function(propertyName) {
      this.toggleProperty("star");
    },
    'toggleUnread': function() {
      this.toggleProperty("read");
    },
    'toggleProperty': function(propertyName) {
      this.setProperty(propertyName, 
        !this.hasProperty(propertyName));
    },
    'syncView': function() {
      this.getDom()
        .toggleClass('star', this.hasProperty('star'))
        .toggleClass('like', this.hasProperty('like'))
        .toggleClass('read', this.hasProperty('read'));
    },
    'isExpanded': function() {
      return this.getDom().hasClass('open');
    },
    'resolveUrl': function(url) {
      if (url.match(/^(?:[a-z]+:)?\/\//))
        return url; // Already absolute

      if (typeof this.articleRoot === 'undefined')
      {
        // Determine and store article root and path
        var articleUrl = this.details.link;

        this.articleRoot = articleUrl;
        this.articlePath = articleUrl;

        var m = articleUrl.match(/^([^:]+:\/\/[^/]+)\//);
        if (m)
          this.articleRoot = m[1];

        m = articleUrl.match(/(\/[^\/]*)$/);
        if (m && m.index >= this.articleRoot.length)
          this.articlePath = articleUrl.substr(0, m.index);
      }

      if (url) {
        if (url.substr(0, 1) == '/')
          url = this.articleRoot + url;
        else
          url = this.articlePath + '/' + url;
      }

      return url;
    },
    'expand': function() {
      var entry = this;
      var details = entry.details;
      var subscription = this.getSubscription();
      var $entry = this.getDom();

      if (this.isExpanded())
        return;

      if (!this.hasProperty('read'))
        this.setProperty('read', true);

      var $content = 
        $('<div />', { 'class' : 'gofr-entry-content' })
          .append($('<div />', { 'class' : 'gofr-article' })
            .append($('<a />', { 'href' : details.link, 'target' : '_blank', 'class' : 'gofr-article-title' })
              .append($('<h2 />')
                .text(details.title)))
            .append($('<div />', { 'class' : 'gofr-article-author' }))
            .append($('<div />', { 'class' : 'gofr-article-body' })
              .append(details.content)))
          .append($('<div />', { 'class' : 'gofr-entry-footer'})
            .append($('<span />', { 'class' : 'action-star' })
              .click(function(e) {
                entry.toggleStarred();
              }))
            .append($('<span />', { 'class' : 'action-unread gofr-entry-action'})
              .text(_l("Keep unread"))
              .click(function(e) {
                entry.toggleUnread();
              })))
          .click(function(e) {
            e.stopPropagation();
          });

      var template;
      if (details.author)
        template = _l("from (%s)[%s] by %s", [subscription.link, subscription.title, details.author]);
      else
        template = _l("from (%s)[%s]", [subscription.link, subscription.title]);

      $content.find('.gofr-article-author').html(template);
      if (!subscription.link)
        $content.find('.gofr-article-author a').contents().unwrap();

      // Links in the content should open in a new window
      $content.find('.gofr-article-body a').attr('target', '_blank');

      // Resolve relative URLs
      $content.find('.gofr-article-body img').not('[src^="http"],[src^="https"]').each(function() {
        $(this).attr('src', function(index, value) {
          return entry.resolveUrl(value);
        })
      });
      $content.find('.gofr-article-body a').not('[href^="http"],[href^="https"]').each(function() {
        $(this).attr('href', function(index, value) {
          return entry.resolveUrl(value);
        })
      });

      $entry.toggleClass('open', true);
      $entry.append($content);
    },
    'scrollIntoView': function() {
      this.getDom().scrollintoview({ duration: 0});
    },
    'collapse': function() {
      this.getDom()
        .removeClass('open')
        .find('.gofr-entry-content')
          .remove();
    },
    'select': function() {
      $('#gofr-entries').find('.gofr-entry.selected').removeClass('selected');
      this.getDom().addClass('selected');
    },
  };

  $$menu.click(function(e) {
    var $item = e.$item;
    if ($item.is('.menu-all-items, .menu-new-items, .menu-starred-items')) {
      var subscription = getSelectedSubscription();
      if (subscription != null)
        subscription.refresh();
      $('.mark-all-as-read').toggle(!$('#menu-filter').isSelected('.menu-starred-items'));
    } else if ($item.is('.menu-show-sidebar')) {
      ui.toggleSidebar(e.isChecked);
    } else if ($item.is('.menu-show-all-subs')) {
      ui.toggleReadSubscriptions(e.isChecked);
    } else if ($item.is('.menu-create-folder')) {
      ui.createFolder();
    } else if ($item.is('.menu-subscribe, .menu-rename, .menu-unsubscribe, .menu-delete')) {
      var subscription = subscriptionMap[e.context];
      if ($item.is('.menu-subscribe')) {
        ui.subscribe(subscription);
      } else if ($item.is('.menu-rename')) {
        ui.rename(subscription);
      } else if ($item.is('.menu-unsubscribe')) {
        ui.unsubscribe(subscription);
      } else if ($item.is('.menu-delete')) {
        ui.removeFolder(subscription);
      }
    }
  });

  var ui = {
    'init': function() {
      this.localizeStatics();
      this.initHelp();
      this.initButtons();
      this.initMenus();
      this.initShortcuts();
      this.initModals();

      $('a.import-subscriptions').click(function() {
        ui.showImportSubscriptionsModal();
        return false;
      });

      $('a.show-about').click(function() {
        ui.showAbout();
        return false;
      });

      $('#menu-filter').selectItem('.menu-all-items');

      this.toggleSidebar($.cookie('show-sidebar') !== 'false');
      this.toggleReadSubscriptions($.cookie('show-all-subs') !== 'false');
    },
    'initButtons': function() {
      $('button.refresh').click(function() {
        refresh();
      });
      $('button.subscribe').click(function() {
        ui.subscribe();
      });
      $('button.navigate').click(function(e) {
        $('#floating-nav')
          .css( { top: $('button.navigate').offset().top, left: $('button.navigate').offset().left })
          .show();

        e.stopPropagation();
      });
      $('.select-article.up').click(function() {
        ui.openArticle(-1);
      });
      $('.select-article.down').click(function() {
        ui.openArticle(1);
      });
      $('.mark-all-as-read').click(function() {
        ui.markAllAsRead();
      });

      $('#import-subscriptions .modal-ok').click(function() {
        var $modal = $(this).closest('.modal');
        var $form = $('#import-subscriptions form');

        if (!$form.find('input[type=file]').val()) {
          // No file specified
          return;
        }

        // Get upload URL
        $.post('authUpload', {
        },
        function(response) {
          // Set the client ID
          $form.find('input[name=client]').val(clientId);

          // Upload the file
          $form
            .attr('action', response.uploadUrl)
            .ajaxSubmit( {
              success: function(response) {
                ui.showToast(response.message, false);
              },
              dataType: 'json',
            });

          // Dismiss the modal
          $modal.showModal(false);
        }, 'json');
      });
    },
    'initMenus': function() {
      $('body')
        .append($('<ul />', { 'id': 'menu-filter', 'class': 'menu selectable' })
          .append($('<li />', { 'class': 'menu-all-items group-filter' })
            .append($('<span />').text(_l("All items"))))
          .append($('<li />', { 'class': 'menu-new-items group-filter', 'data-value': 'unread' })
            .append($('<span />').text(_l("New items"))))
          .append($('<li />', { 'class': 'menu-starred-items group-filter', 'data-value': 'star' })
            .append($('<span />').text(_l("Starred")))))
        .append($('<ul />', { 'id': 'menu-settings', 'class': 'menu' })
          .append($('<li />', { 'class': 'menu-show-sidebar checkable' })
            .append($('<span />').text(_l("Show sidebar"))))
          .append($('<li />', { 'class': 'menu-show-all-subs checkable' })
            .append($('<span />').text(_l("Show read subscriptions")))))
        .append($('<ul />', { 'id': 'menu-folder', 'class': 'menu' })
          .append($('<li />', { 'class': 'menu-subscribe' }).text(_l("Subscribe…")))
          .append($('<li />', { 'class': 'menu-rename' }).text(_l("Rename…")))
          .append($('<li />', { 'class': 'menu-delete' }).text(_l("Delete…"))))
        .append($('<ul />', { 'id': 'menu-root', 'class': 'menu' })
          .append($('<li />', { 'class': 'menu-create-folder' }).text(_l("New folder…")))
          .append($('<li />', { 'class': 'menu-subscribe' }).text(_l("Subscribe…"))))
        .append($('<ul />', { 'id': 'menu-leaf', 'class': 'menu' })
          .append($('<li />', { 'class': 'menu-rename' }).text(_l("Rename…")))
          .append($('<li />', { 'class': 'menu-unsubscribe' }).text(_l("Unsubscribe…"))));
    },
    'initHelp': function() {
      var categories = [{
        'title': _l('Navigation'),
        'shortcuts': [
          { keys: _l('j/k'),       action: _l("Open next/previous article") },
          { keys: _l('n/p'),       action: _l("Move to next/previous article") },
          { keys: _l('Shift+n/p'), action: _l("Move to next/previous subscription") },
          { keys: _l('Shift+o'),   action: _l("Open subscription or folder") },
          { keys: _l('g, then a'), action: _l("Open All Items") },
        ]}, {
        'title': _l('Application'),
        'shortcuts': [
          { keys: _l('r'), action: _l("Refresh") },
          { keys: _l('u'), action: _l("Toggle sidebar") },
          { keys: _l('a'), action: _l("Add subscription") },
          { keys: _l('?'), action: _l("Help") },
        ]}, {
        'title': _l('Articles'),
        'shortcuts': [
          { keys: _l('m'),       action: _l("Mark as read/unread") },
          { keys: _l('s'),       action: _l("Star article") },
          { keys: _l('v'),       action: _l("Open link") },
          { keys: _l('o'),       action: _l("Open article") },
          // { keys: _l('t'),       action: _l("Tag article") },
          // { keys: _l('l'),       action: _l("Like article") },
          { keys: _l('Shift+a'), action: _l("Mark all as read") },
        ]}];

      var maxColumns = 2; // Number of columns in the resulting table

      // Build the table
      var $table = $('<table/>');
      for (var i = 0, n = categories.length; i < n; i += maxColumns) {
        var keepGoing = true;
        for (var k = -1; keepGoing; k++) {
          var $row = $('<tr/>');
          $table.append($row);
          keepGoing = false;

          for (var j = 0; j < maxColumns && i + j < n; j++) {
            var category = categories[i + j];

            if (k < 0) { // Header
              $row.append($('<th/>', { 'colspan': 2 })
                .text(category.title));
              keepGoing = true;
            } else if (k < category.shortcuts.length) {
              $row.append($('<td/>', { 'class': 'sh-keys' })
                .text(category.shortcuts[k].keys + ':'))
              .append($('<td/>', { 'class': 'sh-action' })
                .text(category.shortcuts[k].action));
              keepGoing = true;
            } else { // Empty cell
              $row.append($('<td/>', { 'colspan': 2 }));
            }
          }
        }
      }

      $('body').append($('<div />', { 'class': 'shortcuts' }).append($table));
    },
    'initShortcuts': function() {
      $(document)
        .bind('keypress', '', function() {
          $('.shortcuts').hide();
          $('#floating-nav').hide();
          $$menu.hideAll();
        })
        .bind('keypress', 'n', function() {
          ui.selectArticle(1);
        })
        .bind('keypress', 'p', function() {
          ui.selectArticle(-1);
        })
        .bind('keypress', 'j', function() {
          ui.openArticle(1);
        })
        .bind('keypress', 'k', function() {
          ui.openArticle(-1);
        })
        .bind('keypress', 'o', function() {
          ui.openArticle(0);
        })
        .bind('keypress', 'r', function() {
          refresh();
        })
        .bind('keypress', 's', function() {
          if ($('.gofr-entry.selected').length)
            $('.gofr-entry.selected').data('entry').toggleStarred();
        })
        .bind('keypress', 'm', function() {
          if ($('.gofr-entry.selected').length)
            $('.gofr-entry.selected').data('entry').toggleUnread();
        })
        .bind('keypress', 'shift+n', function() {
          ui.highlightSubscription(1);
        })
        .bind('keypress', 'shift+p', function() {
          ui.highlightSubscription(-1);
        })
        .bind('keypress', 'shift+o', function() {
          if ($('.subscription.highlighted').length) {
            $('.subscription.highlighted')
              .removeClass('highlighted')
              .data('subscription').select();
          }
        })
        .bind('keypress', 'g', function() {
          lastGPressTime = new Date().getTime();
        })
        .bind('keypress', 'a', function() {
          if (ui.isGModifierActive())
            $('.subscription.root')
              .data('subscription').select();
          else
            ui.subscribe();
        })
        .bind('keypress', 'u', function() {
          ui.toggleSidebar();
        })
        .bind('keypress', 'v', function() {
          if ($('.gofr-entry.selected').length)
            $('.gofr-entry.selected').find('.gofr-entry-link')[0].click();
        })
        // .bind('keypress', 'l', function()
        // {
        //   if ($('.gofr-entry.selected').length)
        //     toggleLiked($('.gofr-entry.selected'));
        // })
        // .bind('keypress', 't', function()
        // {
        //   editTags($('.gofr-entry.selected'));
        // })
        .bind('keypress', 'shift+a', function() {
          ui.markAllAsRead();
        })
        .bind('keypress', 'shift+?', function() {
          $('.shortcuts').show();
        });
    },
    'initModals': function() {
      $('.modal-blocker').hide();
      $('.modal').hide();

      $.fn.showModal = function(show) {
        if (!$(this).hasClass('modal'))
          return;

        if (show) {
          $('.modal-blocker').show();
          $(this).show();
        } else {
          $('.modal-blocker').hide();
          $(this).hide();
        }
      };

      $('.modal-cancel').click(function() {
        $(this).closest('.modal').showModal(false);
        return false;
      });
    },
    'showImportSubscriptionsModal': function() {
      $('#import-subscriptions').find('form')[0].reset();
      $('#import-subscriptions').showModal(true);
    },
    'showAbout': function() {
      $('#about').showModal(true);
    },
    'isGModifierActive': function() {
      return new Date().getTime() - lastGPressTime < 1000;
    },
    'toggleSidebar': function(showSidebar) {
      if (typeof showSidebar === 'undefined')
        showSidebar = $('body').hasClass('floated-nav');

      $('body').toggleClass('floated-nav', !showSidebar);
      $('.menu-show-sidebar').setChecked(showSidebar);

      if ($('body').hasClass('floated-nav'))
        $('#floating-nav').append($('.feeds-container'));
      else
        $('#reader').prepend($('.feeds-container'));

      $.cookie('show-sidebar', showSidebar);
    },
    'toggleReadSubscriptions': function(showAllSubscriptions) {
      if (typeof showAllSubscriptions === 'undefined')
        showAllSubscriptions = $('body').hasClass('hide-read-subs');

      $('body').toggleClass('hide-read-subs', !showAllSubscriptions);
      $('.menu-show-all-subs').setChecked(showAllSubscriptions);

      $.cookie('show-all-subs', showAllSubscriptions);
    },
    'updateUnreadCount': function() {
      // Update the 'new items' caption in the dropdown to reflect
      // the unread count

      var selectedSubscription = getSelectedSubscription();
      var caption;

      if (!selectedSubscription || selectedSubscription.unread === null)
        caption = _l("New items");
      else if (selectedSubscription.unread == 0)
        caption = _l("No new items");
      else
        caption = _l("%1$s new item(s)", [selectedSubscription.unread]);

      $('.menu-new-items').setTitle(caption);

      // Update the title bar

      var root = subscriptionMap[""];
      var title = 'Gofr';

      if (root.unread > 0)
        title += ' (' + root.unread + ')';

      document.title = title;
    },
    'highlightSubscription': function(which, scrollIntoView) {
      var $highlighted = $('.subscription.highlighted');
      if (!$highlighted.length)
        $highlighted = $('.subscription.selected');

      var $next = null;
      var $allFeeds = $('#subscriptions .subscription:visible');
      var highlightedIndex = $allFeeds.index($highlighted);

      if (which < 0) {
        if (highlightedIndex - 1 >= 0)
          $next = $($allFeeds[highlightedIndex - 1]);
      } else if (which > 0) {
        if ($highlighted.length < 1)
          $next = $($allFeeds[0]);
        else {
          if (highlightedIndex + 1 < $allFeeds.length)
            $next = $($allFeeds[highlightedIndex + 1]);
        }
      }

      if ($next) {
        $('.subscription.highlighted').removeClass('highlighted');
        $next.addClass('highlighted');

        scrollIntoView = (typeof scrollIntoView !== 'undefined') ? scrollIntoView : true;
        if (scrollIntoView)
          $('.subscription.highlighted').scrollintoview({ duration: 0});
      }
    },
    'selectArticle': function(which, scrollIntoView) {
      if (which < 0) {
        if ($('.gofr-entry.selected').prev('.gofr-entry').length > 0)
          $('.gofr-entry.selected')
            .removeClass('selected')
            .prev('.gofr-entry')
            .addClass('selected');
      } else if (which > 0) {
        var $next = null;
        var $selected = $('.gofr-entry.selected');

        if ($selected.length < 1)
          $next = $('#gofr-entries .gofr-entry:first');
        else
          $next = $selected.next('.gofr-entry');

        $('.gofr-entry.selected').removeClass('selected');
        $next.addClass('selected');

        if ($next.next('.gofr-entry').length < 1)
          $('.next-page').click(); // Load another page - this is the last item
      }

      scrollIntoView = (typeof scrollIntoView !== 'undefined') ? scrollIntoView : true;
      if (scrollIntoView)
        $('.gofr-entry.selected').scrollintoview({ duration: 0});
    },
    'openArticle': function(which) {
      this.selectArticle(which, false);

      if (!$('.gofr-entry-content', $('.gofr-entry.selected')).length || which === 0)
        $('.gofr-entry.selected')
          .click()
          .scrollintoview();
    },
    'collapseAllEntries': function() {
      $('.gofr-entry.open').removeClass('open');
      $('.gofr-entry .gofr-entry-content').remove();
    },
    'showToast': function(message, isError) {
      if (message) {
        $('#toast span').text(message);
        $('#toast').attr('class', isError ? 'error' : 'info');

        if ($('#toast').is(':hidden')) {
          $('#toast')
            .fadeIn()
            .delay(8000)
            .fadeOut('slow'); 
        }
      }
    },
    'subscribe': function(parentFolder) {
      var url = prompt(_l("Site or feed URL:"));
      if (url) {
        if (url.indexOf('http://') != 0 && url.indexOf('https://') != 0)
          url = 'http://' + url;

        if (!parentFolder)
          parentFolder = getRootSubscription();

        parentFolder.subscribe(url);
      }
    },
    'rename': function(subscription) {
      var newName = prompt(_l("New name:"), subscription.title);
      if (newName && newName != subscription.title)
        subscription.rename(newName);
    },
    'createFolder': function() {
      var folderName = prompt(_l('Name of folder:'));
      if (folderName) {
        $.post('createFolder', {
          folderName : folderName,
        },
        function(response) {
          resetSubscriptionDom(response, false);
        }, 'json');
      }
    },
    'unsubscribe': function(subscription) {
      if (confirm(_l("Unsubscribe from %s?", [subscription.title])))
        subscription.unsubscribe();
    },
    'markAllAsRead': function() {
      var subscription = getSelectedSubscription();
      if (subscription == null || subscription.unread < 1)
        return;

      if (subscription.unread > 10 && !confirm(_l("Mark %s messages as read?", [subscription.unread])))
        return;

      var filter = $('.group-filter.selected-menu-item').data('value');
      subscription.markAllAsRead(filter);
    },
    'removeFolder': function(folder) {
      if (!confirm(_l("You will be unsubscribed from all subscriptions in this folder. Delete %s?", [folder.title])))
        return;

      folder.removeFolder();
    },
    'removeSubscriptionEntries': function(subscription) {
      $('#gofr-entries .gofr-entry').each(function() {
        var $entry = $(this);
        var entry = $entry.data('entry');

        if (entry.source == subscription.id)
          $entry.remove();
      });
    },
    'pruneDeadEntries': function() {
      $('#gofr-entries .gofr-entry').each(function() {
        var $entry = $(this);
        var entry = $entry.data('entry');

        if (!subscriptionMap[entry.source])
          $entry.remove();
      });

      this.onEntryListUpdate();
    },
    'onEntryListUpdate': function() {
      var $centerMessage = $('.center-message');
      if ($('#gofr-entries .gofr-entry').length)
        $centerMessage.hide();
      else {
        // List of entries is empty
        $centerMessage.empty();
        $('.next-page').remove();

        if ($('.subscription').length <= 1) {
          // User has no subscriptions (root node doesn't count)
          $centerMessage
            .append($('<p />')
              .text(_l("You have not subscribed to any feeds.")))
            .append($('<p />')
              .append($('<a />', { 'href': '#' })
                .text(_l("Subscribe"))
                .click(function() {
                  ui.subscribe();
                  return false;
                }))
              .append($('<span />')
                .text(_l(" or ")))
              .append($('<a />', { 'href': '#' })
                .text(_l("Import subscriptions"))
                .click(function() {
                  ui.showImportSubscriptionsModal();
                  return false;
                })));
        } else {
          // User has at least one (non-root) subscription
          $centerMessage
            .append($('<p />')
              .text(_l("No items are available for the current view.")));

          if (!$('#menu-filter').isSelected('.menu-all-items')) {
            // Something other than 'All items' is selected
            // Show a toggle link
            $centerMessage
              .append($('<p />')
                .append($('<a />', { 'href' : '#' })
                  .text(_l("Show all items"))
                  .click(function() {
                    var selectedSubscription = getSelectedSubscription();
                    if (selectedSubscription != null) {
                      $('#menu-filter').selectItem('.menu-all-items');
                      selectedSubscription.refresh();
                    }

                    return false;
                  })));
          }
        }

        $centerMessage.show();
      }
    },
    'localizeStatics': function() {
      $('._l').each(function() {
        var $el = $(this);
        if ($el.text())
          $el.html(function(index, text) { return _l(text); });
        if ($el.attr('title'))
          $el.attr('title', function(index, value) { return _l(value); });
      });
    },
  };

  var getRootSubscription = function() {
    if ($('.subscription.root').length > 0)
      return $('.subscription.root').data('subscription');

    return null;
  };

  var getSelectedSubscription = function() {
    if ($('.subscription.selected').length > 0)
      return $('.subscription.selected').data('subscription');

    return null;
  };

  var generateSubscriptionMap = function(userSubs) {
    var map = { "": [] };
    var fmap = { };
    var idCounter = 0;

    // Create a combined list of folders & subscriptions
    $.each(userSubs.folders, function(index, folder) {
      folder.domId = 'sub-' + idCounter++;
      folder.link = null;
      folder.unread = 0;

      // Inject methods
      for (var name in folderMethods)
        folder[name] = folderMethods[name];

      if (folder.isRoot())
        folder.title = _l("All items");

      if (!map[folder.id])
        map[folder.id] = [];

      fmap[folder.id] = folder;
      map[""].push(folder);
    });

    var root = fmap[""];
    $.each(userSubs.subscriptions, function(index, subscription) {
      subscription.domId = 'sub-' + idCounter++;

      for (var name in subscriptionMethods)
        subscription[name] = subscriptionMethods[name];

      if (!subscription.parent)
        map[""].push(subscription);
      else {
        fmap[subscription.parent].unread += subscription.unread;
        map[subscription.parent].push(subscription);
      }

      root.unread += subscription.unread;
    });

    $.each(map, function(parentId, children) {
      // Sort the list of children by title
      children.sort(function(a, b) {
        var aTitle = a.title.toLowerCase();
        var bTitle = b.title.toLowerCase();

        if (a.isRoot())
          return -1;
        else if (b.isRoot())
          return 1;

        if (aTitle < bTitle)
          return -1;
        else if (aTitle > bTitle)
          return 1;

        return 0;
      });
    });

    delete fmap;
    
    return map;
  };

  var resetSubscriptionDom = function(userSubscriptions, reloadItems) {
    var selectedSubscription = getSelectedSubscription();
    var selectedSubscriptionId = null;

    if (selectedSubscription != null)
      selectedSubscriptionId = selectedSubscription.id;

    $('#subscriptions').empty();

    if (subscriptionMap != null)
      delete subscriptionMap;

    subscriptionMap = {};

    var subMap = generateSubscriptionMap(userSubscriptions);
    var createSubDom = function(subscription) {
      var $subscription = $('<li />', { 'class' : 'subscription ' + subscription.domId })
        .data('subscription', subscription)
        .append($('<div />', { 'class' : 'subscription-item' })
          .append($('<span />', { 'class' : 'chevron' })
            .click(function(e) {
              var $menu = $('#menu-' + subscription.getType());
              $menu.openMenu(e.pageX, e.pageY, subscription.id);
              e.stopPropagation();
            }))
          .append($('<img />', { 
            'class' : 'subscription-icon', 
            'src': 'content/favicon-placeholder.png' 
          }))
          .append($('<span />', { 'class' : 'subscription-title' })
            .text(subscription.title))
          .attr('title', subscription.title)
          .append($('<span />', { 'class' : 'subscription-unread-count' }))
          .click(function() {
            subscription.select();
          }))
        .bind('contextmenu', function(e) {
          var $menu = $('#menu-' + subscription.getType());
          $menu.openMenu(e.pageX, e.pageY, subscription.id);
          return false;
        });

      if (!subscription.isFolder()) {
        // Favicons
        $subscription.find('.subscription-icon')
          .attr('src', subscription.getFavIconUrl());

        // Drag-and-drop code
        $subscription
          .mousedown(function(e) {
            var $elem = $(document.elementFromPoint(e.pageX, e.pageY)).closest('.subscription');
            if (!$elem.length)
              return;

            $('#subscriptions').mousemove(function(e) {
              if (!$dragSource) {
                $dragSource = $elem;
                $dragSource.addClass('dragged');
                $dragClone = $dragSource.clone().removeClass('dragged').addClass('dragging');
                dragDestination = null;

                return;
              }

              var dragSource = $dragSource.data('subscription');
              var $hoveredElement = $(document.elementFromPoint(e.pageX, e.pageY));

              if ($hoveredElement) {
                var $sub = $hoveredElement.closest('.subscription');
                var sub = $sub.data('subscription');

                var $newParent = null;
                var newParentId = null;

                if ($sub.is('li.folder')) {
                  $newParent = $sub.children('ul:first');
                  newParentId = sub.id;
                  dragDestination = sub;
                } else if (sub != null) {
                  $newParent = $sub.closest('ul');
                  newParentId = sub.parent;
                  dragDestination = subscriptionMap[sub.parent || ''];
                } else {
                  return false;
                }

                $('#subscriptions .dragging').remove();

                if (newParentId != dragSource.parent) {
                  var $followingElement = null;

                  $newParent.children('li').each(function() {
                    var $child = $(this);
                    var child = $child.data('subscription');

                    if (dragSource.title.toUpperCase() < child.title.toUpperCase()) {
                      $followingElement = $child;
                      return false;
                    }
                  });

                  if ($followingElement != null)
                    $dragClone.insertBefore($followingElement);
                  else
                    $dragClone.appendTo($newParent);
                }
              }
            });

            return false;
          });
      }

      return $subscription.addClass(subscription.getType());
    };

    var buildDom = function($parent, subscriptions) {
      $.each(subscriptions, function() {
        var subscription = this;
        var $subscription = createSubDom(subscription);

        $parent.append($subscription);
        if (subscription.id) {
          var children = subMap[subscription.id];
          if (children) {
            var $child = $('<ul />');
            $subscription.append($child);

            buildDom($child, children);
          }
        }

        subscriptionMap[subscription.id] = subscription;
        subscription.syncView();

        if (selectedSubscriptionId == subscription.id)
          selectedSubscription = subscription;
        else if (selectedSubscriptionId == null) {
          if (subscription.isFolder() && subscription.isRoot())
            selectedSubscription = subscription;
        }
      });
    };

    buildDom($('#subscriptions'), subMap[""]);

    selectedSubscription.select(reloadItems);
  };

  var refresh = function() {
    $.getJSON('subscriptions', {
    })
    .success(function(response) {
      resetSubscriptionDom(response);
    });
  };

  var initChannels = function() {
    clientId = Math.random() + "";

    $.post('initChannel', {
      'client': clientId,
    },
    function(response) {
      channel = new goog.appengine.Channel(response.token);
      socket = channel.open();

      socket.onopen = function() {
        if (console && console.debug)
          console.debug("Channel open");
      };
      socket.onclose = function() {
        // Reconnect
        if (console && console.debug) {
          console.debug("Channel closed");
          initChannels();
        }
      };
      socket.onmessage = function(m) {
        var obj = $.parseJSON(m.data);
        if (obj.error)
          ui.showToast(obj.error, true);
        else {
          if (obj.message)
            ui.showToast(obj.message, false);
          if (obj.refresh)
            refresh();
        }
      };
      socket.onerror = function(error) {
        if (console && console.debug)
          console.debug("Received an error: " + error);
      };
    }, 'json');
  };

  ui.init();
  initChannels();

  refresh();
});
