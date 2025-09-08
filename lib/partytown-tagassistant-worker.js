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
    if (!win[GTM_DEBUG_QUEUE_NAME]) {
      verbose('Queue not present yet in worker. Aborting patch for now.');
      return false; 
    }

    const q = win[GTM_DEBUG_QUEUE_NAME];
    verbose('Worker sees queue. typeof:', typeof q, 'has push:', !!(q && q.push));

    // If it's a callable queue, wrap it once
    if (typeof q === 'function' && !q.__isPtWrapped) {
      log('GTM queue is a function. Wrapping to forward to main thread.');
      const originalFn = q;
      const wrapped = function(...args) {
        verbose('Intercepted GTM worker queue call (fn). Args:', args);
        for (const arg of args) {
          try { tunnel.pushToQueue(arg); } catch (e) { console.error(formatLog('Error forwarding function-queue call:'), e); }
          try { originalFn.call(this, arg); } catch (e) { console.error(formatLog('Error calling original function-queue:'), e); }
        }
        return null;
      };
      wrapped.__isPtWrapped = true;
      wrapped.push = function(...args) { return wrapped.apply(this, args); };
      win[GTM_DEBUG_QUEUE_NAME] = wrapped;
      return true;
    }

    // Existing array-based patch path
    if (!q || typeof q.push !== 'function') {
      return false;
    }

    if (q.__isPtMock) {
      return true;
    }

    log('GTM queue found. Patching its push method.');
    
    const originalPush = q.push;
    q.push = function(...args) {
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
    q.__isPtMock = true;

    // After patching, attempt to flush existing items in the queue
    if (Array.isArray(q) && q.length > 0) {
      log('Flushing ' + q.length + ' temp queued items.');
      q.forEach((item, idx) => {
        // Defer forwarding to main by a tick to avoid re-entrancy during worker init
        setTimeout(() => {
          try {
            tunnel.pushToQueue(item);
          } catch (e) {
            console.error(formatLog('Error flushing item via gtmQueueAccessor:'), e);
          }
        }, idx * 0);
      });
    }
    return true;
  }

  tryPatchAndFlushQueue();

}(window);