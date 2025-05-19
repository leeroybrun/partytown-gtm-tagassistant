!function(win, doc, config, isReady) {
  if ("complete" == doc.readyState) {
    ready();
  } else {
    win.addEventListener("DOMContentLoaded", ready);
    win.addEventListener("load", ready);
  }

  function ready() {
    if (isReady) {
      return;
    }

    isReady = true;

    config = win.partytown || {};
    
    const GTM_DEBUG_QUEUE_NAME = 'google.tagmanager.debugui2.queue';
    const BOOTSTRAP_SCRIPT_SUBSTRINGS = ['googletagmanager.com/debug/bootstrap', 'googletagmanager.com%2Fdebug%2Fbootstrap'];

    const tagAssistant = Object.assign({ enabled: false, debug: false, verbose: false }, config.tagAssistant || {});
    const scriptsToMonitor = tagAssistant.scriptsToMonitor || ['google-analytics.com', 'googletagmanager.com'];

    if (!config.tagAssistant.enabled) {
      log('Partytown Tag Assistant is not enabled.');
      return;
    }

    if (win.__GTM_DEBUG_QUEUE_TUNNEL) {
      log('Tunnel "' + '__GTM_DEBUG_QUEUE_TUNNEL' + '" already initialized.');
      return;
    }

    // Initialize the tunnel object on the win for the worker to access
    const tunnel = win.__GTM_DEBUG_QUEUE_TUNNEL = {
      tagAssistant: tagAssistant,
      patchWorkerQueue: null,
      registerPatchWorkerQueueCallback: function(callbackFromWorker) {
        // This callbackFromWorker is a proxy function that Partytown creates.
        // Calling it here will execute the corresponding function in the worker.
        this.patchWorkerQueue = callbackFromWorker;
        
        log('Worker registered patchWorkerQueue callback.', callbackFromWorker);
      },
      pushToQueue: function(...args) {
        // Initialize the queue if it doesn't exist
        // This way, if bootstrap has not already created the queue, we can still push items into it.
        // Bootstrap will process the queue anyway when it loads
        win[GTM_DEBUG_QUEUE_NAME] = win[GTM_DEBUG_QUEUE_NAME] || [];
        const queue = win[GTM_DEBUG_QUEUE_NAME];

        verbose('GTM message received in main thread. Adding to queue for bootstrap to process.', 'Args:', args);

        try {
          return queue.push.apply(queue, args);
        } catch (e) {
          log('Error calling bootstrap.js push method:', e);
          throw e;
        }
      }
    };

    // A MutationObserver runs too late in the execution flow
    // The script is already loaded by the browser on the main thread when the mutation observer hits
    // We need to intercept the creation of the script element and force the script to be loaded by Partytown
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
      if (String(tagName).toLowerCase() === 'script') {
        const element = originalCreateElement.call(document, tagName);

        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {        
          if (name.toLowerCase() === 'src') {
            // May force set the type to text/partytown if detected as needing Partytown execution
            value = checkAndProcessScript(element, value);
            
          } else if (name.toLowerCase() === 'type') {
            if (shouldAbortTypeChange(element, value)) {
              return;
            }
          }

          return originalSetAttribute.call(this, name, value);
        };

        const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        const originalTypeDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'type');
        Object.defineProperties(element, {
          src: {
            get: function() { 
              return originalSrcDescriptor.get.call(this);
            },
            set: function(value) {
              // May force set the type to text/partytown if detected as needing Partytown execution
              value = checkAndProcessScript(element, value);
              
              return originalSrcDescriptor.set.call(this, value);
            },
            configurable: true,
            enumerable: true
          },
          type: {
            get: function() { 
              return originalTypeDescriptor.get.call(this);
            },
            set: function(value) {
              if (shouldAbortTypeChange(element, value)) {
                return;
              }
              
              return originalTypeDescriptor.set.call(this, value);
            },
            configurable: true,
            enumerable: true
          }
        });

        return element;
      }
      return originalCreateElement.call(document, tagName);
    };

    if (tagAssistant.verbose) {
      if (win.__TAG_ASSISTANT_API && typeof win.__TAG_ASSISTANT_API.sendMessage === 'function' && !win.__TAG_ASSISTANT_API.__pt_wrapped) {
        const originalTASendMessage = win.__TAG_ASSISTANT_API.sendMessage;
        log('Verbose mode enabled. Wrapping win.__TAG_ASSISTANT_API.sendMessage.');

        win.__TAG_ASSISTANT_API.sendMessage = function(message) {
          log('__TAG_ASSISTANT_API.sendMessage called. MessageType:', 
            message ? message.type : 'N/A', 
            message && message.data ? message.data : '');
          
          try {
            return originalTASendMessage.apply(this, arguments);
          } catch (e) {
            log('__TAG_ASSISTANT_API.sendMessage error:', e, 'Message:', message);
            throw e;
          }
        };
        win.__TAG_ASSISTANT_API.__pt_wrapped = true;
        log('Wrapped win.__TAG_ASSISTANT_API.sendMessage.');
      } else {
        log('win.__TAG_ASSISTANT_API.sendMessage not found or already wrapped.');
      }
    }

    function formatLog(message) {
      return [
        '%cPT GTM Tag Assistant - Main 🖥️', 
        'color: rgb(218, 236, 243); background-color: #377ea3; padding: 2px 3px; border-radius: 2px; font-size: 0.8em;',
        message
      ];
    }
  
    function log(message, ...args) {
      args = [...formatLog(message), ...args];
      if(tagAssistant.debug) console.log(...args);
    }
  
    function verbose(message, ...args) {
      args = [...formatLog(message), ...args];
      if(tagAssistant.verbose) console.log(...args);
    }
  
    const dispatchPartytownEvent = function() {
      win.dispatchEvent(new CustomEvent("ptupdate"));
      log('Dispatched ptupdate.');
    };
  
    // When the bootstrap script loads the second gtm.js with debug params, 
    // it's loading it from the first gtm.js URL which contains the proxy URL.
    //
    // The real gtm.js is encoded in the "url" parameter of the proxy URL.
    // So, when bootstrap adds the debug parameters at the end of the URL, 
    // they are not encoded, and so when the URL is passed to the proxy, 
    // we load the same first gtm.js WITHOUT the debug parameters.
    // ---> "https://proxyserver?url=https%3A%2F%2Fwww.googletagmanager.com%2Fgtm.js%3Fid%3DGTM-xxxx&gtm_debug=x&gtm_auth=xxxxxxxxxxxxxxxx&gtm_preview=env-xxx"
    //
    // This function extracts the real gtm.js URL from the proxy URL and returns it, 
    // so Partytown can once again pass it into resolveUrl to encode it fully and correctly.
    const cleanProxyUrl = function(url) {
      if (tagAssistant.decodeProxyUrl) {
        url = url.toString();
  
        if (typeof tagAssistant.decodeProxyUrl === 'string' && url.includes(tagAssistant.decodeProxyUrl)) {
          url = url.replace(tagAssistant.decodeProxyUrl, '');
  
          // Decode the URL that was in the url parameter of the proxy URL
          url = decodeURIComponent(url);
        } else if (typeof tagAssistant.decodeProxyUrl === 'function') {
          url = tagAssistant.decodeProxyUrl(url);
        }
      }
  
      return url;
    };
  
    function isBootstrapScript(src) {
      return BOOTSTRAP_SCRIPT_SUBSTRINGS.some(substring => src.includes(substring));
    }
  
    // Use same method as testIfMustLoadScriptOnMainThread in Partytown
    function escapeRegExp(input) {
      return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function testStringAgainstPatterns(patterns, value) {
      return (
        patterns
        ?.map((val) => new RegExp(typeof val === 'string' ? escapeRegExp(val) : val))
        .some((regexp) => regexp.test(value)) ?? false
      );
    }
  
    // Which script should we process when created on the page
    function shouldProcessScript(src) {
      return src && testStringAgainstPatterns(scriptsToMonitor, src);
    }
  
    const checkAndProcessScript = function(element, currentSrc) {
      currentSrc = currentSrc.toString();
  
      // Only process scripts that contains our proxy URL
      if (shouldProcessScript(currentSrc)){
        var realSrc = cleanProxyUrl(currentSrc);
  
        if(isBootstrapScript(realSrc)) {
          log('Intercepted bootstrap script. Notifying worker...', realSrc, element);
          
          // Bootstrap is detected as being created on the page, likely by gtm.js
          // It means gtm.js has initialized the debug queue
          //
          // We can request the worker to patch the queue .push method on his side and 
          // start flushing items into the main thread's queue.
          //
          // Items will be picked up by bootstrap when it loads
          setTimeout(() => { tunnel.patchWorkerQueue(); }, 0);
  
        // This is not the bootstrap script, but we may still need to force the script to be loaded by Partytown
        } else if (!testStringAgainstPatterns(config.loadScriptsOnMainThread, realSrc)) {
          log('Intercepted script, forcing Partytown execution:', realSrc, element);
          
          // Flag to prevent a script from changing its type to something else than text/partytown
          element.setAttribute('data-force-partytown', true);
  
          // Force the script to be loaded by Partytown
          element.setAttribute('type', 'text/partytown');
  
          setTimeout(dispatchPartytownEvent, 0);
  
          return realSrc;
        }
      }
  
      return currentSrc;
    }
  
    const shouldAbortTypeChange = function(element, value) {
      value = value.toString();
  
      if (element.getAttribute('data-force-partytown') && !value.includes('text/partytown')) {
        log('Intercepted type change of script to load in Partytown. Aborting type set.', element);
        
        return true;
      }
  
      return false;
    }
  }
}(window, document);