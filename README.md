# Enable Tag Assistant with GTM running in Partytown

Run GTM in Partytown while still being able to use Tag Assistant for debug.

## How to

1. Copy the files from `src/lib/` into your Partytown `lib/` folder
    - `lib/partytown-tagassistant-loader.js`
    - `lib/partytown-tagassistant-main.js`
    - `lib/partytown-tagassistant-worker.js`
2. Configure Partytown as demonstrated in `scr/index.html`
4. Load the scripts either by including `lib/partytown-tagassistant-loader.js` or by adding them manually BEFORE the GTM script
    ```
    <script type="text/javascript" src="lib/partytown-tagassistant-main.js"></script>
    <script type="text/partytown" src="lib/partytown-tagassistant-worker.js"></script>
    ```
3. Tag Assistant should now successfully connect to GTM inside Partytown


## GTM analysis and how does it works

### Components of GTM

- `/gtm.js` script
- `/debug/bootstrap` script
- `/gtm.js` script with `gtm_debug=x` parameter
- badge iframe (no src)
- `/debug/badge` script in iframe
- service worker iframe (`/static/service_worker/.../sw_iframe.html`)
- Tag Assistant extension

### Important variables/objects

- `window.__TAG_ASSISTANT_API` (sendMessage & `message` event listener)
    - Communication channel from Tag Assistant API
- `window['google.tagmanager.debugui2.queue']` (debug queue array)
    - Commuication queue between gtm.js & bootstrap script
    - gtm.js pushes messages to array
    - bootstrap script hook onto array's `push` method to process them
- `debugBadgeApi` object created inside the badge iframe by bootstrap to communicates with it

### Other variables/objects created

- `window.google_tag_manager`

### GTM execution flow in debug mode

From a lot of debugging and a lot of trial and error, this seems to be the execution flow of GTM in debug mode and the interactions between all the components.

- `gtm.js` script loaded
- Detects debug mode
- Create debug queue array with `CONTAINER_STARTING` (debug=false) first message
- Register callback to resume execution on this first message
- Loads `/debug/bootstrap` script
- Bootstrap reads debug queue and hook onto `push` method to be notified of future messages
- Sends first `CONTAINER_STARTING` (debug=false) message to Tag Assistant extension
- Listen for messages from Tag Assistant extension on `window.__TAG_ASSISTANT_API`
- On first `PING` message from Tag Assistant
    - Creates floating badge iframe and set `debugBadgeApi` inside to communicate with it
    - `/debug/badge` script is loaded inside iframe and register to `debugBadgeApi`
- Tag Assistant receive `CONTAINER_STARTING` with `debug=false` and processes it
- Tag Assistant sends back a `CONTAINER_DETAILS` to bootstrap to load `gtm.js` with debug params
- Bootstrap receives `CONTAINER_DETAILS` message
- Bootstrap loads `/gtm.js` script with `gtm_debug=x` parameter
- `/gtm.js?gtm_debug=x` script re-check if in debug mode
- Sees that the queue array already exists, so it doesn't re-load `/debug/bootstrap`
- Push a second `CONTAINER_STARTING` message to the debug queue with **debug=true** and a new `resume` callback function
- Message intercepted by bootstrap's `push` hook
- Bootstrap finally calls gtm `resume` function from one of the `CONTAINER_STARTING` messages
    - Mecanism still a bit unclear to me, seems to call the `resume` callback from the message with debug=false
        - This is the callback from gtm.js WITHOUT gtm_debug parameter (?)
- `gtm.js` loads a service worker iframe on the page
    - https://www.googletagmanager.com/static/service_worker/xxxx/sw_iframe.html?origin=ORIGIN_URL

### Parts of the flow still unclear to me

- The rest of the flow once resume() is called
- When exactly the service worker iframe is created
- The difference between `gtm.js` and `gtm.js?gtm_debug=x`
- Which `resume()` callback is called between `gtm.js` and `gtm.js?gtm_debug=x`, and exactly WHEN it is called
- The Tag Assistant inner workings

### Why a Second `gtm.js` Load?

- The bootstrap script likely needs to intercept GTM's execution and data.
- The first GTM load provides the *means* for this interception (the queue and the `resume` function).
- The bootstrap script establishes its own context, iframe, and communication channels.
- To properly instrument and monitor the GTM container, Tag Assistant needs GTM to initialize *while Tag Assistant's hooks are in place*. 
- The second load of `gtm.js` (initiated via the bootstrap script after it's set up) allows GTM to run in an environment where Tag Assistant is ready to observe it.

### CONTAINER_STARTING examples

#### debug = false
```
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
        "resume": callback function from gtm.js
    }
}
```

#### debug = true
```
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
        "resume": callback function from gtm.js?gtm_debug=x
    }
}
```

### Detailled execution flow of GTM in debug mode

- `gtm.js` script
    - Check for debug mode
        - `gtm_debug=x` (or similar) is in the URL
        - `tagassistant.google.com` is the referer
        - `__TAG_ASSISTANT` cookie exists
        - `data-tag-assistant-present` on `document`
        - `TADebugSignal` event
    - If debug mode
        - Check if `window['google.tagmanager.debugui2.queue']` exists
        - If it doesn't exists yet
            - `window['google.tagmanager.debugui2.queue'] = []`
            - Add the `/debug/bootstrap` script to the page
            - Push a new event into `window['google.tagmanager.debugui2.queue']` with these important properties:
                - **messageType**: `CONTAINER_STARTING`
                - **debug**: `false`
                - **data.resume()** 
                    - method to resume execution of gtm.js once bootstrap is loaded
                - **initialPublish**: `true`
            - This queue is the primary way this initial GTM script passes its configuration and the ability to resume its own execution to the bootstrap script.
    - If debug mode is not detected OR the `window['google.tagmanager.debugui2.queue']` array already exists, `/debug/bootstrap` is NOT loaded
- `/debug/bootstrap` script
    - Check if the queue `window["google.tagmanager.debugui2.queue"]` exists
        - If it doesn't exists, bootstrap initialize it
            - `window['google.tagmanager.debugui2.queue'] = []`
    - Reads `window["google.tagmanager.debugui2.queue"]`
        - Ideally, the queue should contains the first `CONTAINER_STARTING` from gtm.js
    - Sets up `message` event listeners on `window.__TAG_ASSISTANT_API` (mostly with Tag Assistant extension)
        - Sets up an interval to check heartbeat
        - Important messages received by bootstrap from Tag Assistant
            - `PING`: heartbeat
                - Upon first `PING` received with locale provided
                    - Initialize the badge UI + iframe
                        - Creates an `<iframe class="__TAG_ASSISTANT_BADGE">`
                        - Gets the iframe's window object
                        - Exposes a `debugBadgeApi` **inside** the iframe for the badge UI script to use.
                        - Writes HTML into the iframe. This HTML includes:
                            - A `<script>` tag loading `badgeScriptUrl`. This is the script for the actual Tag Assistant floating badge UI that will use `window.debugBadgeApi`
            - `CONTAINER_DETAILS`: sent by Tag Assistant when it receives and process the first `CONTAINER_STARTING`
                - This basically asks to loads `gtm.js` **with debug parameters** (`gtm_debug=x`)
    - Sets up a function to process the queue and immediately calls it
        - Iterate trough items in `window["google.tagmanager.debugui2.queue"]`
        - Sends these items to the Tag Assistant extension using `window.__TAG_ASSISTANT_API.postMessage`
        - Seems to check for `CONTAINER_STARTING` and calls the `resume` callback (but ONLY on debug=false messages?)
    - Hooks onto `window["google.tagmanager.debugui2.queue"].push` method
        - Bootstrap hooks onto the queue array's push method
        - Everytime an item is pushed onto the queue, it calls the function above to process it and send it to Tag Assistant
- `gtm.js` script with `gtm_debug=x` parameter (loaded by bootstrap)
    - Sends a second `CONTAINER_STARTING` message to the debug queue with `debug=true`
        - Also attach a resume() callback onto that message
    - This message is picked-up by bootstrap and it's `push` debug queue hook
- Badge iframe
    - Once initialized, load the `/debug/badge` script
    - The `/debug/badge` expects the `debugBadgeApi` (inserted by bootstrap) to be available on the global scope
    - It listen and communicates with bootstrap using different methods and events on this `debugBadgeApi` object
- Tag Assistant extension
    - Once Tag Assistant sees the first `CONTAINER_STARTING` message with `debug: false`
        - It sends a `CONTAINER_DETAILS` message to bootstrap 
        - Bootstrap loads `gtm.js` **with debug parameters** (`gtm_debug=x`)

### Running GTM in Partytown while still enabling Tag Assistant

Here is a recap of the challenges faced when trying to run GTM in Partytown while still enabling Tag Assistant to work:

- Running GTM fully in Partytown with `/debug/bootstrap` script also in Partytown
    - How it seemed to be implemented by a lot of examples up until now
        - Superside OSS Partytown GTM Plugin & Rapidez GTM created a tunnel for `window.__TAG_ASSISTANT_API` between main thread & Partytown for bootstrap to communicate with Tag Assistant
    - Doesn't seem to work anymore (at least for me)
    - An issue occured when bootstrap (in worker) tried to call .open() on the debug iframe it created (on main thread). The Partytown worker had an internal reference winId of the iframe, but this winId was not initialized/known of the man thread.
    - Tried to implement a fix to make the first call to getIframeEnv synchronously call the main thread to initialize the window and get the real winId to use in the worker to initialize the iframe environment/window
    - Required changes to Partytown source code
    - This fixed the winId issue and bootstrap could call .open() from the worker on the iframe successfully and set the iframe content
    - The issue is that then, the badge script was executed inside the iframe and it expected debugBadgeApi to be available
    - bootstrap had not created debugBadgeApi yet inside the iframe window context (because of asynchronous nature between main thread badge script & bootstrap in worker?)
    - Tried forcing the badge script to run inside Partytown, but this caused other issues
    - As it required changes to the Partytown source files to fix the winId issue, and yet it still didn't work, this idea was abandonned

- Running GTM in Partytown with `/debug/bootstrap` on main thread
    - Enables `/debug/bootstrap` to create the debug floating iframe and set `debugBadgeApi` inside
    - Prevent race conditions between `/debug/bootstrap` in worker & badge script on main thread
    - No need to tunnel `window.__TAG_ASSISTANT_API` now that bootstrap is on main thread
    - Challenges
        - Enable communication between `gtm.js` (Partytown worker) & `/debug/bootstrap` (main thread)
            - Hook onto `window['google.tagmanager.debugui2.queue'].push` in worker to receive messages from gtm.js
                - Main communication mecanism between `gtm.js` & `/debug/bootstrap`
        - Need to wait for gtm.js to initialize `window['google.tagmanager.debugui2.queue']` before hooking into it
            - If we initialize it ourselves in the worker, then `gtm.js` doesn't load `/debug/bootstrap`
            - As debug queue is initialized right before loading `/debug/bootstrap` onto the page in `gtm.js`:
                - Need to detect on main thread the moment `/debug/bootstrap` is added to the page to notify worker to hook onto debug queue
                - This needs to happen BEFORE `/debug/bootstrap` executes and load the second `gtm.js?gtm_debug=x`, as it will send the second `CONTAINER_STARTING` message with `debug=true` that we need to forward from the worker to the main thread
        - With `/debug/bootstrap` loaded on main thread, the scripts it creates will NOT be intercepted by Partytown
            - They will be created with type `text/javascript` on the page and loaded on the main thread
            - So, if we do nothing, the `gtm.js?gtm_debug=x` load from bootstrap will happens **on main thread**
            - **We don't want that**, we want `gtm.js?gtm_debug=x` to be loaded in Partytown as well
            - Need to detect the moment `gtm.js?gtm_debug=x` is CREATED on the page to force type `text/partytown`
                - Tried to use a MutationObserver, but at the time it was triggered, `gtm.js?gtm_debug=x` was already loaded by the browser. Even if we tried to remove the element/change it's type, change it's src, etc
                - Had to hook earlier in the creation process, when bootstrap calls createElement instead and sets it's src/type
                - This way we can force it to load in Partytown by setting type=`text/partytown`
            - The issue is the same for other scripts created by `/debug/bootstrap`
                - We need to make sure ALL scripts created by `/debug/bootstrap` are loaded in Partytown, EXCEPT for scripts in the `loadScriptsOnMainThread` exclusion list of Partytown
        - Bootstrap/Tag Assistant are adding the `&gtm_debug=x&...` parameters at the end of the proxified URL of GTM
            - If for example, gtm.js URL is resolved in Partytown resolveUrl to `https://myproxy?url=https%3A%2F%2Fwww.googletagmanager.com%2Fgtm.js%3Fid%3DGTM-xxxxxxx`
            - Then, bootstrap/Tag Assistant will try to load gtm.js with debug params using this URL: `https://myproxy?url=https%3A%2F%2Fwww.googletagmanager.com%2Fgtm.js%3Fid%3DGTM-xxxxxxx&gtm_debug=x&gtm_...`
            - The new parameters are NOT URL encoded (especially their `&`)
            - The proxy treats then a separate URL parameters and NOT as being part of the `url` parameter
            - When the proxy reads the `url` parameter, it still reads the URL **without** gtm_debug=x&...
                - `https://myproxy?url=https%3A%2F%2Fwww.googletagmanager.com%2Fgtm.js%3Fid%3DGTM-xxxxxxx`
                - This, in fact, load the same exact gtm.js we already loaded (with debug flag inactive)
            - We need to make sure the parameters added by bootstrap to the gtm.js URL are also URL encoded and part of the `url` parameter sent to the proxy

