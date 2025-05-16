!function(win, config) {
  const GTM_DEBUG_QUEUE_NAME = 'google.tagmanager.debugui2.queue';

  function formatLog(message) {
    return [
      '%cPT GTM Tag Assistant - Worker 🔧', 
      'color: rgb(235, 242, 213); background-color: #69832d; padding: 2px 3px; border-radius: 2px; font-size: 0.8em;',
      message
    ];
  }

  if (typeof win.__GTM_DEBUG_QUEUE_TUNNEL === 'undefined' ||
    typeof win.__GTM_DEBUG_QUEUE_TUNNEL.registerPatchWorkerQueueCallback !== 'function') {
    console.warn(...formatLog('Main thread tunnel "__GTM_DEBUG_QUEUE_TUNNEL" not found. Cannot listen for bootstrap readiness. Please check __GTM_DEBUG_QUEUE_TUNNEL is correctly added to the mainWindowAccessors config of Partytown.'));

    return;
  }
  
  const tunnel = win.__GTM_DEBUG_QUEUE_TUNNEL;

  const tagAssistant = Object.assign({ enabled: false, debug: false, verbose: false }, tunnel.tagAssistant || {});

  function log(message, ...args) {
    args = [...formatLog(message), ...args];
    if(tagAssistant.debug) console.log(...args);
  }

  function verbose(message, ...args) {
    args = [...formatLog(message), ...args];
    if(tagAssistant.verbose) console.log(...args);
  }

  if (!tagAssistant.enabled) {
    log('Partytown Tag Assistant is not enabled.');
    return;
  }

  log('Script executing in worker.');

  try {
    tunnel.registerPatchWorkerQueueCallback(function() {
      log('Received bootstrap ready signal from main thread via tunnel.');

      tryPatchAndFlushQueue(); // Attempt to patch/flush immediately
    });
    log('Registered patchWorkerQueueCallback with main thread tunnel.');
  } catch (e) {
    log('Error registering patchWorkerQueueCallback with main thread tunnel:', e);
  }

  function tryPatchAndFlushQueue() {
    // We have to wait for gtm.js to create the queue array
    if (!win[GTM_DEBUG_QUEUE_NAME] || typeof win[GTM_DEBUG_QUEUE_NAME].push !== 'function') {
      return false; 
    }

    if (win[GTM_DEBUG_QUEUE_NAME].__isPtMock) {
      return true;
    }

    log('GTM queue found. Patching its push method.');

    const queue = win[GTM_DEBUG_QUEUE_NAME];
    
    const originalPush = queue.push;
    queue.push = function(...args) {
      verbose('Intercepted GTM worker push.', 'Args:', args);

      try {
        originalPush.apply(this, args);

        // Forward the item to the main thread queue
        return tunnel.pushToQueue(...args);
      } catch (e) {
        console.error(formatLog('Error calling gtmQueueAccessor.pushToBootstrapQueue:'), e);
      }

      return null;
    };
    queue.__isPtMock = true;

    // After patching, attempt to flush existing items in the queue
    if (queue.length > 0) {
      log('Flushing ' + queue.length + ' temp queued items.');

      queue.forEach(item => {
        try {
          tunnel.pushToQueue(item);
        } catch (e) {
          console.error(formatLog('Error flushing item via gtmQueueAccessor:'), e);
        }
      });
    }
    return true;
  }

  tryPatchAndFlushQueue();

}(window);