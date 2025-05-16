!function(win, config) {
  config = win.partytown || {};
  const tagAssistant = Object.assign({ enabled: false, debug: false, verbose: false }, config.tagAssistant || {});

  const GTM_DEBUG_QUEUE_NAME = 'google.tagmanager.debugui2.queue';

  if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Worker] Script executing in worker.');

  if (typeof win.__GTM_DEBUG_QUEUE_TUNNEL === 'undefined' ||
    typeof win.__GTM_DEBUG_QUEUE_TUNNEL.registerPatchWorkerQueueCallback !== 'function') {
    console.warn('[PT GTM Debug Queue - Worker] Main thread tunnel "__GTM_DEBUG_QUEUE_TUNNEL" not found. Cannot listen for bootstrap readiness. Please check __GTM_DEBUG_QUEUE_TUNNEL is correctly added to the mainWindowAccessors config of Partytown.');

    return;
  }
  
  const tunnel = win.__GTM_DEBUG_QUEUE_TUNNEL;

  try {
    tunnel.registerPatchWorkerQueueCallback(function() {
      if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Worker] Received bootstrap ready signal from main thread via tunnel.');

      tryPatchAndFlushQueue(); // Attempt to patch/flush immediately
    });
    if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Worker] Registered notifyCallback with main thread bootstrap signal accessor.');
  } catch (e) {
    if(tagAssistant.debug) console.error('[PT GTM Debug Queue - Worker] Error registering notifyCallback with bootstrap signal accessor:', e);
  }

  function tryPatchAndFlushQueue() {
    // We have to wait for gtm.js to create the queue array
    if (!win[GTM_DEBUG_QUEUE_NAME] || typeof win[GTM_DEBUG_QUEUE_NAME].push !== 'function') {
      return false; 
    }

    if (win[GTM_DEBUG_QUEUE_NAME].__isPtMock) {
      return true;
    }

    if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Worker] GTM queue found. Patching its push method.');

    const queue = win[GTM_DEBUG_QUEUE_NAME];
    
    const originalPush = queue.push;
    queue.push = function(...args) {
      if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Worker] Intercepted GTM worker push.', 'Args:', args);

      try {
        originalPush.apply(this, args);

        // Forward the item to the main thread queue
        return tunnel.pushToQueue(...args);
      } catch (e) {
        console.error('[PT GTM Debug Queue - Worker] Error calling gtmQueueAccessor.pushToBootstrapQueue:', e);
      }

      return null;
    };
    queue.__isPtMock = true;

    // After patching, attempt to flush existing items in the queue
    if (queue.length > 0) {
      if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Worker] Flushing ' + queue.length + ' temp queued items.');

      queue.forEach(item => {
        try {
          tunnel.pushToQueue(item);
        } catch (e) {
          console.error('[PT GTM Debug Queue - Worker] Error flushing item via gtmQueueAccessor:', e);
        }
      });
    }
    return true;
  }

  tryPatchAndFlushQueue();

}(window);