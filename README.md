# Partytown GTM Tag Assistant

> Run Google Tag Manager inside Partytown while still being able to use Tag Assistant for debugging.

## Table of Contents
- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [How It Works (Simple Explanation)](#how-it-works-simple-explanation)
- [Implementation Details](#implementation-details)
- [GTM Components Analysis](#gtm-components-analysis)

## Quick Start

1. Copy the files from `lib/` into your Partytown `lib/` folder:
    - `lib/partytown-tagassistant-loader.js`
    - `lib/partytown-tagassistant-main.js`
    - `lib/partytown-tagassistant-worker.js`

2. Configure Partytown as shown below:

```javascript
// In your Partytown configuration
{
  // Regular Partytown config...
  
  // Add these items for Tag Assistant support:
  loadScriptsOnMainThread: [
    // Your existing patterns...
    /(\/|%2F)debug(\/|%2F)?/,  // or /(\/|%2F)debug(\/|%2F)bootstrap/
  ],
  
  mainWindowAccessors: [
    // Your existing accessors...
    '__GTM_DEBUG_QUEUE_TUNNEL'
  ],
  
  // Add Tag Assistant configuration
  tagAssistant: {
    enabled: true,
    debug: true,
    verbose: false,
    scriptsToMonitor: [
      'google-analytics.com',
      'googletagmanager.com',
      'myproxy' // Add your proxy domain/URL if you're using one
    ],
    decodeProxyUrl: 'https://myproxy?url='
  }
}
```

3. Load the scripts by either:
   - Including `lib/partytown-tagassistant-loader.js` in your HTML
   - Or adding them manually BEFORE the GTM script:
   
```html
<script type="text/javascript" src="lib/partytown-tagassistant-main.js"></script>
<script type="text/partytown" src="lib/partytown-tagassistant-worker.js"></script>

<!-- Load Partytown AFTER these scripts -->
<script type="text/javascript" src="lib/partytown.js"></script>

<!-- Your GTM script would follow, for example: -->
<script type="text/partytown" src="https://www.googletagmanager.com/gtm.js?id=GTM-xxxxxxx"></script>
<script type="text/javascript">
  // Initialize dataLayer to ensure it's available
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(){dataLayer.push(arguments);}

  // Push the standard GTM initialization event
  window.dataLayer.push({
    'gtm.start': new Date().getTime(), 
    'event': 'gtm.js'
  });
</script>
```

4. Tag Assistant should now successfully connect to GTM running inside Partytown!

You can check `index.html` for a full example.

## Configuration Options

### tagAssistant.enabled
Enable the Tag Assistant helper (required).

### tagAssistant.debug
Output debug logs to the console for troubleshooting.

### tagAssistant.verbose
Hook onto `window.__TAG_ASSISTANT_API` to output all messages between bootstrap & Tag Assistant to the console.

### tagAssistant.scriptsToMonitor
An array of patterns checked whenever a `script` element is created on the page. 

If a script's `src` contains any of these patterns, it's checked against Partytown's `loadScriptsOnMainThread` rules. If `src` matches `scriptsToMonitor` but doesn't match `loadScriptsOnMainThread`, the script's type will be forced to `text/partytown` to be loaded by Partytown.

This is necessary because GTM debug bootstrap (running on the main thread) will append scripts that need to be intercepted and forced to run in Partytown. These patterns help identify those scripts.

Please note that **ALL scripts created using `document.createElement` on the page** for which the `src` matches `scriptsToMonitor` and doesn't match `loadScriptsOnMainThread` will be forced into Partytown!

### tagAssistant.decodeProxyUrl
Used when running with a proxy server. Set this to:

- The base proxy URL (e.g., `'https://myproxy?url='`)
- `false` if not using a proxy
- A function for complex proxy setups:

```javascript
  decodeProxyUrl: function(url) {
    if(url.includes('https://myproxy')) {
      url = url.replace('https://myproxy?url=', '');
      url = decodeURIComponent(url);
    }
    return url;
}
```

## How It Works

The solution works by:

1. Setting up a communication tunnel between main thread and worker
2. Forcing GTM debug bootstrap to run on main thread where Tag Assistant expects it
3. Intercepting scripts created by bootstrap to force them to run in Partytown
4. Forwarding debug messages from GTM in the worker to the main thread

## Implementation Details

The implementation follows these key steps:

1. `partytown-tagassistant-main.js` loads on the main thread BEFORE Partytown & GTM
2. It creates the `__GTM_DEBUG_QUEUE_TUNNEL` object on the main thread window
3. It hooks onto `document.createElement` to monitor `<script>` elements creation
4. Partytown loads
5. Partytown loads `partytown-tagassistant-worker.js` via `type="text/partytown"`
6. Worker registers a callback to be notified when `/debug/bootstrap` script is created by `gtm.js` via the tunnel object passed via `mainWindowAccessors`
7. Partytown loads `gtm.js`
8. GTM detects debug mode and loads `/debug/bootstrap` script
9. Bootstrap loads on main thread (via `loadScriptsOnMainThread` pattern)
10. Main script detects bootstrap's creation and notifies the worker
11. Worker hooks onto GTM's debug queue before bootstrap loads
12. Worker flushes existing queue items to the main thread
13. Main thread receives items and adds them to the main thread queue
14. Bootstrap loads the queue and communicates with Tag Assistant
15. Tag Assistant asks bootstrap to load GTM with debug parameters
16. Bootstrap creates a script onto the page with `type="text/javascript"` to load `gtm.js?gtm_debug=x...`
17. Main script detects this script creation and checks against `scriptsToMonitor` and `loadScriptsOnMainThread`
18. Since this script shouldn't run on main thread, it forces `type="text/partytown"`
19. Partytown loads this script in the worker
20. This process repeats for all scripts created by bootstrap
21. GTM in the worker pushes messages to its debug queue
22. Worker forwards these messages to the main thread's queue
23. Bootstrap sees the messages and forwards them to Tag Assistant
24. Tag Assistant displays all the messages from GTM running inside Partytown 🎉

## GTM Components Analysis

### Core Components

- `/gtm.js` script - The primary GTM script
- `/debug/bootstrap` script - Manages debug mode and Tag Assistant
- `/gtm.js` script with `gtm_debug=x` parameter - Debug-enabled GTM
- Badge iframe (no src) - Displays the floating Tag Assistant UI
- `/debug/badge` script - Loads in the badge iframe
- Service worker iframe - Used by GTM for various operations
- Tag Assistant extension - Chrome extension that communicates with GTM

### Key Communication Channels

- `window.__TAG_ASSISTANT_API` - Communication with Tag Assistant extension
- `window['google.tagmanager.debugui2.queue']` - Debug queue between GTM and bootstrap
- `debugBadgeApi` - Communication with the floating badge iframe

### Debug Mode Detection
GTM checks for debug mode based on:
- `gtm_debug=x` parameter in URL
- `tagassistant.google.com` referer
- `__TAG_ASSISTANT` cookie
- `data-tag-assistant-present` attribute on document
- `TADebugSignal` event

### Debug Flow Analysis

When GTM runs in debug mode:

1. **Initial Load**
   - GTM checks for debug mode indicators
   - Creates debug queue array with initial `CONTAINER_STARTING` message
   - Loads the `/debug/bootstrap` script

2. **Bootstrap Initialization**
   - Bootstrap hooks into the debug queue
   - Sets up communication with Tag Assistant
   - Creates the badge UI iframe

3. **Debug-Enabled GTM**
   - Tag Assistant asks Bootstrap to load GTM with debug parameters
   - Second GTM load occurs with `gtm_debug=x` parameter
   - Second `CONTAINER_STARTING` message is sent with `debug=true`

4. **Communication Flow**
   - GTM pushes messages to debug queue
   - Bootstrap processes these messages and forwards to Tag Assistant
   - Tag Assistant displays data in its UI

### Example Debug Messages

#### CONTAINER_STARTING (debug=false)
```json
{
    "messageType": "CONTAINER_STARTING",
    "data": {
        "scriptSource": "https://www.googletagmanager.com/gtm.js?id=GTM-xxxxxxx",
        "containerProduct": "GTM",
        "debug": false,
        "id": "GTM-xxxxxxx",
        "targetRef": {
            "ctid": "GTM-xxxxxxx",
            "isDestination": false
        },
        "aliases": [
            "GTM-xxxxxxx"
        ],
        "destinations": [],
        "resume": "function reference"
    }
}
```

#### CONTAINER_STARTING (debug=true)
```json
{
    "messageType": "CONTAINER_STARTING",
    "data": {
        "scriptSource": "https://www.googletagmanager.com/gtm.js?id=GTM-xxxxxxx&gtm_debug=x&gtm_auth=xxxxxxxxxxxxx&gtm_preview=env-xxx",
        "containerProduct": "GTM",
        "debug": true,
        "id": "GTM-xxxxxxx",
        "targetRef": {
            "ctid": "GTM-xxxxxxx",
            "isDestination": false
        },
        "aliases": [
            "GTM-xxxxxxx"
        ],
        "destinations": [],
        "resume": "function reference"
    }
}
```

### Key Implementation Challenges

Our solution addresses several challenges:

1. **Communication Bridge**: Establishing reliable communication between GTM in the worker and bootstrap on the main thread. Allowing bootstrap to easily communicate with debug iframe.

2. **Script Interception**: Detecting and intercepting scripts created by bootstrap to force them to run in Partytown.

3. **URL Encoding**: Ensuring proper handling of URL parameters when using a proxy, especially the debug parameters added by Tag Assistant/Bootstrap.

4. **Timing**: Managing the execution sequence to ensure proper hooking into debug queues and message forwarding. As `gtm.js` expects the `window['google.tagmanager.debugui2.queue']` array NOT to exist on the first load to then load `/debug/bootstrap`, we have to wait for bootstrap to be created for us to hook into the queue created by `gtm.js`.

By solving these challenges, this integration allows Tag Assistant to work seamlessly with GTM running inside Partytown, maintaining performance benefits while enabling debugging capabilities. 
