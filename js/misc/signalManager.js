const GObject = imports.gi.GObject;
const Lang = imports.lang;

const _signalIsConnected = function(signal) {
    let [sigName, obj, callback, id] = signal;
    if (!obj) {
        return false;
    }
    if (obj instanceof GObject.Object) { // GObject
        // MetaWindowActor is always destroyed in muffin, so accessing the
        // object here will trigger finalized object warnings from CJS.
        if (obj.is_finalized()) {
            return false;
        }
        return GObject.signal_handler_is_connected(obj, id);
    }
    if ('signalHandlerIsConnected' in obj) { // JS Object
        return obj.signalHandlerIsConnected(id);
    }

    return false;
};

const _disconnect = function(results) {
    for (let i = 0; i < results.length; i++) {
        let [sigName, obj, callback, id] = results[i];
        obj.disconnect(id);
    }
};

/**
 * #SignalManager:
 * @short_description: A convenience object for managing signals
 * @_object (Object): The object owning the SignalManager. All callbacks are
 * binded to %_object unless otherwise specified.
 * @_storage (Array): An array that stores all the connected signals. Each
 * signal is stored as an array in the form `[signalName, object, callback,
 * signalId]`.
 *
 * The #SignalManager is a convenience object for managing signals. If you use
 * this to connect signals, you can later disconnect them by signal name or
 * just disconnect everything! No need to keep track of those annoying
 * @signalIds by yourself anymore!
 *
 * A common use case is to use the #SignalManager to connect to signals and then
 * use the @disconnectAllSignals function when the object is destroyed, to
 * avoid keeping track of all the signals manually.
 *
 * However, this is not always needed. If you are connecting to a signal of
 * your actor, the signals are automatically disconnected when you destroy the
 * actor. Using the #SignalManager to disconnect all signals is only needed when
 * connecting to objects that persists after the object disappears.
 *
 * Every Javascript object should have its own @SignalManager, and use it to
 * connect signals of all objects it takes care of. For example, the panel will
 * have one #SignalManger object, which manages all signals from #GSettings,
 * `global.screen` etc.
 *
 * An example usage is as follows:
 * ```
 * class MyApplet extends Applet.Applet {
 *     constructor(orientation, panelHeight, instanceId) {
 *         super(orientation, panelHeight, instanceId);
 *
 *         this._signalManager = new SignalManager.SignalManager(null);
 *         this._signalManager.connect(global.settings, "changed::foo", (...args) => this._onChanged(...args));
 *     }
 *
 *     _onChanged() {
 *         // Do something
 *     }
 *
 *     on_applet_removed_from_panel() {
 *         this._signalManager.disconnectAllSignals();
 *     }
 * }
 * ```
 */

var debug = false;

var SignalManager = class SignalManager {
    /**
     * _init:
     * @object (Object): the object owning the #SignalManager (usually @this) (Deprecated)
     */
    constructor(object) {
        if (object) {
            global.dump_gjs_stack(
                'Initializing SignalManager with an object is deprecated.' +
                ' Please bind the callback before passing it to SignalManager.'
            );
        }
        this._storage = [];
    }

    /**
     * connect:
     * @obj (Object): the object whose signal we are listening to
     * @sigName (string): the name of the signal we are listening to
     * @callback (function): the callback function
     * @bind (Object): (optional) the object to bind the function to. Leave
     * empty for the owner of the #SignalManager (which has no side effects if
     * you don't need to bind at all).
     * @force (boolean): whether to connect again even if it is connected
     *
     * This listens to the signal @sigName from @obj and calls @callback when
     * the signal is emitted. @callback is bound to the @bind argument if passed.
     *
     * This checks whether the signal is already connected and will not connect
     * again if it is already connected. This behaviour can be overridden by
     * settings @force to be @true.
     *
     * For example, what you would normally write as
     * ```
     * global.settings.connect("changed::foo", Lang.bind(this, this._bar))
     * ```
     * would become
     * ```
     * this._signalManager.connect(global.settings, "changed::foo", this._bar)
     * ```
     *
     * Note that in this function, the first argument is the object, while the
     * second is the signal name. In all other methods, you first pass the
     * signal name, then the object (since the object is rarely passed in other
     * functions).
     */
    _connect(method, obj, sigName, callback, bind, force) {
        if (debug) {
            log(`SignalManager connecting to '${sigName} of ${obj}`);
        }

        if (!obj || (!force && this.isConnected(sigName, obj, callback)))
            return;

        let id = bind ? obj[method](sigName, Lang.bind(bind, callback))
            : obj[method](sigName, callback);

        this._storage.push([sigName, obj, callback, id]);
    }

    connect() {
        this._connect('connect', ...arguments);
    }

    connect_after() {
        this._connect('connect_after', ...arguments);
    }

    /**
     * isConnected:
     * @sigName (string): the signal we care about
     * @obj (Object): (optional) the object we care about, or leave empty if we
     * don't care about which object it is
     * @callback (function): (optional) the callback function we care about, or
     * leave empty if we don't care about what callback is connected
     *
     * This checks whether the signal @sigName is connected. The optional
     * arguments @obj and @callback can be used to specify what signals in
     * particular we want to know. Note that when you supply @callBack, you
     * usually want to supply @obj as well, since two different objects can
     * connect to the same signal with the same callback.
     *
     * This is functionally equivalent to (and implemented as)
     * ```
     * this.getSignals(arguments).length > 0);
     * ```
     *
     * Returns: Whether the signal is connected
     */
    isConnected() {
        return this.getSignals.apply(this, arguments).length > 0;
    }

    /**
     * getSignals:
     * @sigName (string): the signal we care about
     * @obj (Object): (optional) the object we care about, or leave empty if we
     * don't care about which object it is
     * @callback (function): (optional) the callback function we care about, or
     * leave empty if we don't care about what callback is connected
     *
     * This returns the list of all signals that matches the description
     * provided. Each signal is represented by an array in the form
     * `[signalName, object, callback, signalId]`.
     *
     * Returns (Array): The list of signals
     */
    getSignals(sigName, obj, callback) {
        let results = this._storage;

        if (sigName)
            results = results.filter(x => x[0] == sigName);
        if (obj)
            results = results.filter(x => x[1] == obj);
        if (callback)
            results = results.filter(x => x[2] == callback);

        return results;
    }

    /**
     * disconnect:
     * @sigName (string): the signal we care about
     * @obj (Object): (optional) the object we care about, or leave empty if we
     * don't care about which object it is
     * @callback (function): (optional) the callback function we care about, or
     * leave empty if we don't care about what callback is connected
     *
     * This disconnects all *signals* named @sigName. By default, it
     * disconnects the signal on all objects, but can be fine-tuned with the
     * optional @obj and @callback arguments.
     *
     * This function will do nothing if no such signal is connected, the object
     * no longer exists, or the signal is somehow already disconnected. So
     * checks need not be performed before calling this function.
     */

    disconnect() {
        let results = this.getSignals.apply(this, arguments).filter(_signalIsConnected);
        _disconnect(results);
        this._storage = this._storage.filter((x) => {
            return results.findIndex(function(signalObj) {
                return signalObj[0] === x[0] && signalObj[1] === x[1];
            }) === -1;
        });
    }

    /**
     * disconnectAllSignals:
     *
     * Disconnects *all signals* managed by the #SignalManager. This is useful
     * in the @destroy function of objects.
     */
    disconnectAllSignals() {
        _disconnect(
            this._storage.filter(_signalIsConnected)
        );
        this._storage = [];
    }
}
