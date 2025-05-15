!function(win, config) {
    config = win.partytown || {};
    
    const GTM_DEBUG_QUEUE_NAME = 'google.tagmanager.debugui2.queue';
    const BOOTSTRAP_SCRIPT_SUBSTRINGS = ['googletagmanager.com/debug/bootstrap', 'googletagmanager.com%2Fdebug%2Fbootstrap'];

    const tagAssistant = Object.assign({ enabled: false, debug: false, verbose: false }, config.tagAssistant || {});
    const scriptsToMonitor = tagAssistant.scriptsToMonitor || [config.proxyUrl, 'google-analytics.com', 'googletagmanager.com'];

    if (win.__GTM_DEBUG_QUEUE_TUNNEL) {
        if(tagAssistant.debug) console.warn('[PT GTM Debug Queue - Main] Tunnel "' + '__GTM_DEBUG_QUEUE_TUNNEL' + '" already initialized.');
        return;
    }

    if (!win.__TAG_ASSISTANT_API) {
        if(tagAssistant.debug) console.warn('[PT GTM Debug Queue - Main] win.__TAG_ASSISTANT_API not found!');
    }

    // Create a hidden iframe for gtm service worker
    function gtmHiddenFrame(doc) {
        const f = doc.createElement('iframe');
        f.setAttribute('height', '0');
        f.setAttribute('width', '0');
        f.setAttribute('style', 'display: none; visibility: hidden;');
        doc.body.appendChild(f);
        return f;
    }

    // Double frame is what GTM would normally use without Partytown.
    function gtmDoubleFrame(src) {
        const outerFrame = gtmHiddenFrame(document);
        const innerFrame = gtmHiddenFrame(outerFrame.contentWindow.document);
        innerFrame.setAttribute('crossorigin', '*');
        innerFrame.src = src;
    }

    // Hoist GTM iframe out of Partytown so that GTM can create its own worker normally. Called from resolveUrl.
    new BroadcastChannel('gtm-iframe').onmessage = _ref => {
        if(tagAssistant.debug) console.log('[PT Config] gtm-iframe message received');
        
        let data = _ref.data;
        gtmDoubleFrame(data);
    };

    /*
    * Img elements added by GTM tags for Google Ads normally set themselves as
    * position:absolute. Since Partytown prevents this, a stylesheet is added to
    * restore the style (which remove the added whitespace).
    */
    const styles = document.createElement('style');
    styles.innerText = `body > img[aria-hidden=true] { position: absolute; }`;
    document.head.appendChild(styles);

    // Initialize the tunnel object on the win for the worker to access
    const tunnel = win.__GTM_DEBUG_QUEUE_TUNNEL = {
        patchWorkerQueue: null,
        registerPatchWorkerQueueCallback: function(callbackFromWorker) {
            // This callbackFromWorker is a proxy function that Partytown creates.
            // Calling it here will execute the corresponding function in the worker.
            this.patchWorkerQueue = callbackFromWorker;
            if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Main] Worker registered patchWorkerQueue callback.', callbackFromWorker);
        },
        pushToQueue: function(...args) {
            win[GTM_DEBUG_QUEUE_NAME] = win[GTM_DEBUG_QUEUE_NAME] || [];
            const queue = win[GTM_DEBUG_QUEUE_NAME];

            if(tagAssistant.debug) console.log('[PT GTM Debug Queue - Main] pushToBootstrapQueue called (bootstrap ready). Args:', args);

            try {
                return queue.push.apply(queue, args);
            } catch (e) {
                if(tagAssistant.debug) console.error('[PT GTM Debug Queue - Main] Error calling bootstrap.js push method:', e);
                throw e;
            }
        }
    };

    if (tagAssistant.verbose) {
        if (win.__TAG_ASSISTANT_API && typeof win.__TAG_ASSISTANT_API.sendMessage === 'function' && !win.__TAG_ASSISTANT_API.__pt_wrapped) {
            const originalTASendMessage = win.__TAG_ASSISTANT_API.sendMessage;
            console.log('[PT Main] Verbose mode enabled. Wrapping win.__TAG_ASSISTANT_API.sendMessage.');

            win.__TAG_ASSISTANT_API.sendMessage = function(message) {
                console.log('[PT Main - __TAG_ASSISTANT_API.sendMessage WRAPPER] Called. MessageType:', 
                    message ? message.type : 'N/A', 
                    message && message.data ? message.data : '');
                
                try {
                    return originalTASendMessage.apply(this, arguments);
                } catch (e) {
                    console.error('[PT Main - __TAG_ASSISTANT_API.sendMessage WRAPPER] Error:', e, 'Message:', message);
                    throw e;
                }
            };
            win.__TAG_ASSISTANT_API.__pt_wrapped = true;
            console.log('[PT Main - Bridge] Wrapped win.__TAG_ASSISTANT_API.sendMessage.');
        } else {
            console.warn('[PT Main - Bridge] win.__TAG_ASSISTANT_API.sendMessage not found or already wrapped.');
        }
    }

    const dispatchPartytownEvent = function() {
        win.dispatchEvent(new CustomEvent("ptupdate"));
        if(tagAssistant.debug) console.log('[PT Main - ProcessIntercept] Dispatched ptupdate.');
    };

    // When the bootstrap script loads the second gtm.js with debug params, it's loading it from the first gtm.js URL which contains the proxy URL.
    // The real gtm.js is encoded in the "url" parameter of the proxy URL.
    // So, when bootstrap adds the debug parameters at the end of the URL, they are not encoded, and so when the URL is passed to the proxy, we load the same first gtm.js WITHOUT the debug parameters.
    // ---> "https://proxyserver?url=https%3A%2F%2Fwww.googletagmanager.com%2Fgtm.js%3Fid%3DGTM-xxxx&gtm_debug=x&gtm_auth=xxxxxxxxxxxxxxxx&gtm_preview=env-xxx"
    // This function extracts the real gtm.js URL from the proxy URL and returns it, so Partytown can once again pass it into resolveUrl to encode it fully and correctly.
    const cleanProxyUrl = function(url) {
        url = url.toString();
        
        // Remove the proxy URL if it's present
        if (config && config.proxyUrl) {
            url = url.replace(config.proxyUrl+'?url=', '');
        }

        // Decode the URL that was in the url parameter of the proxy URL
        url = decodeURIComponent(url);

        return url;
    };

    function isBootstrapScript(src) {
        return BOOTSTRAP_SCRIPT_SUBSTRINGS.some(substring => src.includes(substring));
    }

    // Use same method as Partytown
    function escapeRegExp(input) {
        return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function testIfMustLoadScriptOnMainThread(config, value) {
        return (
            config.loadScriptsOnMainThread
            ?.map((val) => new RegExp(typeof val === 'string' ? escapeRegExp(val) : val))
            .some((regexp) => regexp.test(value)) ?? false
        );
    }

    // Which script should we process when created on the page
    function shouldProcessScript(src) {
        return src && scriptsToMonitor.some(substring => src.includes(substring));
    }

    const checkAndForcePartytownExecution = function(element, currentSrc) {
        currentSrc = currentSrc.toString();

        // Only process scripts that contains our proxy URL
        if (shouldProcessScript(currentSrc)){
            var realSrc = cleanProxyUrl(currentSrc);

            if(isBootstrapScript(realSrc)) {
                if(tagAssistant.debug) console.log('[createElement Override] Intercepted bootstrap script. Notifying worker...', realSrc, element);
                
                // Bootstrap is detected asbeing created on the page, likely by gtm.js
                // It means gtm.js has initialized the debug queue
                //
                // We can request the worker to patch the queue .push method on his side and 
                // start flushing items into the main thread's queue.
                //
                // Items will be picked up by bootstrap when it loads
                setTimeout(() => { tunnel.patchWorkerQueue(); }, 0);
            } else if (!testIfMustLoadScriptOnMainThread(config, realSrc)) {
                // This is not the bootstrap script, but we still need to force the script to be loaded by Partytown
                if(tagAssistant.debug) console.log('[createElement Override] Intercepted script, forcing Partytown execution:', realSrc, element);
                
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
            if(tagAssistant.debug) console.log('[createElement Override] Intercepted type change of script to load in Partytown. Aborting type set.', element);
            
            return true;
        }

        return false;
    }

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
                    value = checkAndForcePartytownExecution(element, value);
                    
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
                        if(tagAssistant.debug) console.log('[createElement Override] Setting src:', value, element);

                        // May force set the type to text/partytown if detected as needing Partytown execution
                        value = checkAndForcePartytownExecution(element, value);
                        
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
}(window);