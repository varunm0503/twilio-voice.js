"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @packageDocumentation
 * @module Voice
 */
var events_1 = require("events");
var device_1 = require("./device");
var errors_1 = require("./errors");
var log_1 = require("./log");
var outputdevicecollection_1 = require("./outputdevicecollection");
var mediadeviceinfo_1 = require("./shims/mediadeviceinfo");
var util_1 = require("./util");
/**
 * Aliases for audio kinds, used for labelling.
 * @private
 */
var kindAliases = {
    audioinput: 'Audio Input',
    audiooutput: 'Audio Output',
};
/**
 * Provides input and output audio-based functionality in one convenient class.
 * @publicapi
 */
var AudioHelper = /** @class */ (function (_super) {
    __extends(AudioHelper, _super);
    /**
     * @constructor
     * @private
     * @param onActiveOutputsChanged - A callback to be called when the user changes the active output devices.
     * @param onActiveInputChanged - A callback to be called when the user changes the active input device.
     * @param [options]
     */
    function AudioHelper(onActiveOutputsChanged, onActiveInputChanged, options) {
        var _a;
        var _this = _super.call(this) || this;
        /**
         * A Map of all audio input devices currently available to the browser by their device ID.
         */
        _this.availableInputDevices = new Map();
        /**
         * A Map of all audio output devices currently available to the browser by their device ID.
         */
        _this.availableOutputDevices = new Map();
        /**
         * The currently set audio constraints set by setAudioConstraints().
         */
        _this._audioConstraints = null;
        /**
         * The audio stream of the default device.
         * This is populated when _openDefaultDeviceWithConstraints is called,
         * See _selectedInputDeviceStream for differences.
         * TODO: Combine these two workflows (3.x?)
         */
        _this._defaultInputDeviceStream = null;
        /**
         * Whether each sound is enabled.
         */
        _this._enabledSounds = (_a = {},
            _a[device_1.default.SoundName.Disconnect] = true,
            _a[device_1.default.SoundName.Incoming] = true,
            _a[device_1.default.SoundName.Outgoing] = true,
            _a);
        /**
         * The current input device.
         */
        _this._inputDevice = null;
        /**
         * Whether the {@link AudioHelper} is currently polling the input stream's volume.
         */
        _this._isPollingInputVolume = false;
        /**
         * An instance of Logger to use.
         */
        _this._log = log_1.default.getInstance();
        /**
         * Internal reference to the processed stream
         */
        _this._processedStream = null;
        /**
         * The selected input stream coming from the microphone device.
         * This is populated when the setInputDevice is called, meaning,
         * the end user manually selected it, which is different than
         * the defaultInputDeviceStream.
         * TODO: Combine these two workflows (3.x?)
         */
        _this._selectedInputDeviceStream = null;
        /**
         * A record of unknown devices (Devices without labels)
         */
        _this._unknownDeviceIndexes = {
            audioinput: {},
            audiooutput: {},
        };
        /**
         * Update the available input and output devices
         * @private
         */
        _this._updateAvailableDevices = function () {
            if (!_this._mediaDevices || !_this._enumerateDevices) {
                return Promise.reject('Enumeration not supported');
            }
            return _this._enumerateDevices().then(function (devices) {
                _this._updateDevices(devices.filter(function (d) { return d.kind === 'audiooutput'; }), _this.availableOutputDevices, _this._removeLostOutput);
                _this._updateDevices(devices.filter(function (d) { return d.kind === 'audioinput'; }), _this.availableInputDevices, _this._removeLostInput);
                var defaultDevice = _this.availableOutputDevices.get('default')
                    || Array.from(_this.availableOutputDevices.values())[0];
                [_this.speakerDevices, _this.ringtoneDevices].forEach(function (outputDevices) {
                    if (!outputDevices.get().size && _this.availableOutputDevices.size && _this.isOutputSelectionSupported) {
                        outputDevices.set(defaultDevice.deviceId)
                            .catch(function (reason) {
                            _this._log.warn("Unable to set audio output devices. " + reason);
                        });
                    }
                });
            });
        };
        /**
         * Remove an input device from inputs
         * @param lostDevice
         * @returns Whether the device was active
         */
        _this._removeLostInput = function (lostDevice) {
            if (!_this.inputDevice || _this.inputDevice.deviceId !== lostDevice.deviceId) {
                return false;
            }
            _this._destroyProcessedStream();
            _this._replaceStream(null);
            _this._inputDevice = null;
            _this._maybeStopPollingVolume();
            var defaultDevice = _this.availableInputDevices.get('default')
                || Array.from(_this.availableInputDevices.values())[0];
            if (defaultDevice) {
                _this.setInputDevice(defaultDevice.deviceId);
            }
            return true;
        };
        /**
         * Remove an input device from outputs
         * @param lostDevice
         * @returns Whether the device was active
         */
        _this._removeLostOutput = function (lostDevice) {
            var wasSpeakerLost = _this.speakerDevices.delete(lostDevice);
            var wasRingtoneLost = _this.ringtoneDevices.delete(lostDevice);
            return wasSpeakerLost || wasRingtoneLost;
        };
        options = Object.assign({
            AudioContext: typeof AudioContext !== 'undefined' && AudioContext,
            setSinkId: typeof HTMLAudioElement !== 'undefined' && HTMLAudioElement.prototype.setSinkId,
        }, options);
        _this._updateUserOptions(options);
        _this._audioProcessorEventObserver = options.audioProcessorEventObserver;
        _this._mediaDevices = options.mediaDevices || navigator.mediaDevices;
        _this._onActiveInputChanged = onActiveInputChanged;
        _this._enumerateDevices = typeof options.enumerateDevices === 'function'
            ? options.enumerateDevices
            : _this._mediaDevices && _this._mediaDevices.enumerateDevices.bind(_this._mediaDevices);
        var isAudioContextSupported = !!(options.AudioContext || options.audioContext);
        var isEnumerationSupported = !!_this._enumerateDevices;
        if (options.enabledSounds) {
            _this._enabledSounds = options.enabledSounds;
        }
        var isSetSinkSupported = typeof options.setSinkId === 'function';
        _this.isOutputSelectionSupported = isEnumerationSupported && isSetSinkSupported;
        _this.isVolumeSupported = isAudioContextSupported;
        if (_this.isVolumeSupported) {
            _this._audioContext = options.audioContext || options.AudioContext && new options.AudioContext();
            if (_this._audioContext) {
                _this._inputVolumeAnalyser = _this._audioContext.createAnalyser();
                _this._inputVolumeAnalyser.fftSize = 32;
                _this._inputVolumeAnalyser.smoothingTimeConstant = 0.3;
            }
        }
        _this.ringtoneDevices = new outputdevicecollection_1.default('ringtone', _this.availableOutputDevices, onActiveOutputsChanged, _this.isOutputSelectionSupported);
        _this.speakerDevices = new outputdevicecollection_1.default('speaker', _this.availableOutputDevices, onActiveOutputsChanged, _this.isOutputSelectionSupported);
        _this.addListener('newListener', function (eventName) {
            if (eventName === 'inputVolume') {
                _this._maybeStartPollingVolume();
            }
        });
        _this.addListener('removeListener', function (eventName) {
            if (eventName === 'inputVolume') {
                _this._maybeStopPollingVolume();
            }
        });
        _this.once('newListener', function () {
            // NOTE (rrowland): Ideally we would only check isEnumerationSupported here, but
            //   in at least one browser version (Tested in FF48) enumerateDevices actually
            //   returns bad data for the listed devices. Instead, we check for
            //   isOutputSelectionSupported to avoid these quirks that may negatively affect customers.
            if (!_this.isOutputSelectionSupported) {
                _this._log.warn('Warning: This browser does not support audio output selection.');
            }
            if (!_this.isVolumeSupported) {
                _this._log.warn("Warning: This browser does not support Twilio's volume indicator feature.");
            }
        });
        if (isEnumerationSupported) {
            _this._initializeEnumeration();
        }
        return _this;
    }
    Object.defineProperty(AudioHelper.prototype, "audioConstraints", {
        /**
         * The currently set audio constraints set by setAudioConstraints(). Starts as null.
         */
        get: function () { return this._audioConstraints; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(AudioHelper.prototype, "inputDevice", {
        /**
         * The active input device. Having no inputDevice specified by `setInputDevice()`
         * will disable input selection related functionality.
         */
        get: function () { return this._inputDevice; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(AudioHelper.prototype, "inputStream", {
        /**
         * The current input stream coming from the microphone device or
         * the processed audio stream if there is an {@link AudioProcessor}.
         */
        get: function () { return this._processedStream || this._selectedInputDeviceStream; },
        enumerable: false,
        configurable: true
    });
    /**
     * Destroy this AudioHelper instance
     * @private
     */
    AudioHelper.prototype._destroy = function () {
        this._stopDefaultInputDeviceStream();
        this._stopSelectedInputDeviceStream();
        this._destroyProcessedStream();
        this._maybeStopPollingVolume();
        this.removeAllListeners();
        this._unbind();
    };
    /**
     * Start polling volume if it's supported and there's an input stream to poll.
     * @private
     */
    AudioHelper.prototype._maybeStartPollingVolume = function () {
        var _this = this;
        if (!this.isVolumeSupported || !this.inputStream) {
            return;
        }
        this._updateVolumeSource();
        if (this._isPollingInputVolume || !this._inputVolumeAnalyser) {
            return;
        }
        var bufferLength = this._inputVolumeAnalyser.frequencyBinCount;
        var buffer = new Uint8Array(bufferLength);
        this._isPollingInputVolume = true;
        var emitVolume = function () {
            if (!_this._isPollingInputVolume) {
                return;
            }
            if (_this._inputVolumeAnalyser) {
                _this._inputVolumeAnalyser.getByteFrequencyData(buffer);
                var inputVolume = util_1.average(buffer);
                _this.emit('inputVolume', inputVolume / 255);
            }
            requestAnimationFrame(emitVolume);
        };
        requestAnimationFrame(emitVolume);
    };
    /**
     * Stop polling volume if it's currently polling and there are no listeners.
     * @private
     */
    AudioHelper.prototype._maybeStopPollingVolume = function () {
        if (!this.isVolumeSupported) {
            return;
        }
        if (!this._isPollingInputVolume || (this.inputStream && this.listenerCount('inputVolume'))) {
            return;
        }
        if (this._inputVolumeSource) {
            this._inputVolumeSource.disconnect();
            delete this._inputVolumeSource;
        }
        this._isPollingInputVolume = false;
    };
    /**
     * Call getUserMedia with specified constraints
     * @private
     */
    AudioHelper.prototype._openDefaultDeviceWithConstraints = function (constraints) {
        var _this = this;
        this._log.debug('Opening default device with constraints', constraints);
        return this._getUserMedia(constraints).then(function (stream) {
            _this._log.debug('Opened default device. Updating available devices.');
            // Ensures deviceId's and labels are populated after the gUM call
            // by calling enumerateDevices
            _this._updateAvailableDevices().catch(function (error) {
                // Ignore error, we don't want to break the call flow
                _this._log.warn('Unable to updateAvailableDevices after gUM call', error);
            });
            _this._defaultInputDeviceStream = stream;
            return _this._maybeCreateProcessedStream(stream);
        });
    };
    /**
     * Stop the default audio stream
     * @private
     */
    AudioHelper.prototype._stopDefaultInputDeviceStream = function () {
        if (this._defaultInputDeviceStream) {
            this._log.debug('stopping default device stream');
            this._defaultInputDeviceStream.getTracks().forEach(function (track) { return track.stop(); });
            this._defaultInputDeviceStream = null;
            this._destroyProcessedStream();
        }
    };
    /**
     * Unbind the listeners from mediaDevices.
     * @private
     */
    AudioHelper.prototype._unbind = function () {
        if (!this._mediaDevices || !this._enumerateDevices) {
            throw new errors_1.NotSupportedError('Enumeration is not supported');
        }
        if (this._mediaDevices.removeEventListener) {
            this._mediaDevices.removeEventListener('devicechange', this._updateAvailableDevices);
        }
    };
    /**
     * Update AudioHelper options that can be changed by the user
     * @private
     */
    AudioHelper.prototype._updateUserOptions = function (options) {
        if (typeof options.enumerateDevices === 'function') {
            this._enumerateDevices = options.enumerateDevices;
        }
        if (typeof options.getUserMedia === 'function') {
            this._getUserMedia = options.getUserMedia;
        }
    };
    /**
     * Adds an {@link AudioProcessor} object.
     * The AudioHelper will route the input audio stream through the processor
     * before sending the audio stream to Twilio.
     *
     * Only one {@link AudioProcessor} can be added at this time.
     * @param processor
     */
    AudioHelper.prototype.addProcessor = function (processor) {
        if (this._processor) {
            throw new errors_1.NotSupportedError('Adding multiple AudioProcessors is not supported at this time.');
        }
        if (typeof processor !== 'object' || processor === null) {
            throw new errors_1.InvalidArgumentError('Missing AudioProcessor argument.');
        }
        if (typeof processor.createProcessedStream !== 'function') {
            throw new errors_1.InvalidArgumentError('Missing createProcessedStream() method.');
        }
        if (typeof processor.destroyProcessedStream !== 'function') {
            throw new errors_1.InvalidArgumentError('Missing destroyProcessedStream() method.');
        }
        this._log.debug('Adding processor');
        this._processor = processor;
        this._audioProcessorEventObserver.emit('add');
        return this._restartStreams();
    };
    /**
     * Enable or disable the disconnect sound.
     * @param doEnable Passing `true` will enable the sound and `false` will disable the sound.
     * Not passing this parameter will not alter the enable-status of the sound.
     * @returns The enable-status of the sound.
     */
    AudioHelper.prototype.disconnect = function (doEnable) {
        return this._maybeEnableSound(device_1.default.SoundName.Disconnect, doEnable);
    };
    /**
     * Enable or disable the incoming sound.
     * @param doEnable Passing `true` will enable the sound and `false` will disable the sound.
     * Not passing this parameter will not alter the enable-status of the sound.
     * @returns The enable-status of the sound.
     */
    AudioHelper.prototype.incoming = function (doEnable) {
        return this._maybeEnableSound(device_1.default.SoundName.Incoming, doEnable);
    };
    /**
     * Enable or disable the outgoing sound.
     * @param doEnable Passing `true` will enable the sound and `false` will disable the sound.
     * Not passing this parameter will not alter the enable-status of the sound.
     * @returns The enable-status of the sound.
     */
    AudioHelper.prototype.outgoing = function (doEnable) {
        return this._maybeEnableSound(device_1.default.SoundName.Outgoing, doEnable);
    };
    /**
     * Removes an {@link AudioProcessor}.
     * This takes into effect on the next call
     * or when the input device is changed.
     *
     * @param processor
     */
    AudioHelper.prototype.removeProcessor = function (processor) {
        if (typeof processor !== 'object' || processor === null) {
            throw new errors_1.InvalidArgumentError('Missing AudioProcessor argument.');
        }
        if (this._processor !== processor) {
            throw new errors_1.InvalidArgumentError('Cannot remove an AudioProcessor that has not been previously added.');
        }
        this._destroyProcessedStream();
        this._processor = null;
        this._audioProcessorEventObserver.emit('remove');
        return this._restartStreams();
    };
    /**
     * Set the MediaTrackConstraints to be applied on every getUserMedia call for new input
     * device audio. Any deviceId specified here will be ignored. Instead, device IDs should
     * be specified using {@link AudioHelper#setInputDevice}. The returned Promise resolves
     * when the media is successfully reacquired, or immediately if no input device is set.
     * @param audioConstraints - The MediaTrackConstraints to apply.
     */
    AudioHelper.prototype.setAudioConstraints = function (audioConstraints) {
        this._audioConstraints = Object.assign({}, audioConstraints);
        delete this._audioConstraints.deviceId;
        return this.inputDevice
            ? this._setInputDevice(this.inputDevice.deviceId, true)
            : Promise.resolve();
    };
    /**
     * Replace the current input device with a new device by ID.
     * @param deviceId - An ID of a device to replace the existing
     *   input device with.
     */
    AudioHelper.prototype.setInputDevice = function (deviceId) {
        return this._setInputDevice(deviceId, false);
    };
    /**
     * Unset the MediaTrackConstraints to be applied on every getUserMedia call for new input
     * device audio. The returned Promise resolves when the media is successfully reacquired,
     * or immediately if no input device is set.
     */
    AudioHelper.prototype.unsetAudioConstraints = function () {
        this._audioConstraints = null;
        return this.inputDevice
            ? this._setInputDevice(this.inputDevice.deviceId, true)
            : Promise.resolve();
    };
    /**
     * Unset the input device, stopping the tracks. This should only be called when not in a connection, and
     *   will not allow removal of the input device during a live call.
     */
    AudioHelper.prototype.unsetInputDevice = function () {
        var _this = this;
        if (!this.inputDevice) {
            return Promise.resolve();
        }
        this._destroyProcessedStream();
        return this._onActiveInputChanged(null).then(function () {
            _this._replaceStream(null);
            _this._inputDevice = null;
            _this._maybeStopPollingVolume();
        });
    };
    /**
     * Destroys processed stream and update references
     */
    AudioHelper.prototype._destroyProcessedStream = function () {
        if (this._processor && this._processedStream) {
            this._log.debug('destroying processed stream');
            var processedStream = this._processedStream;
            this._processedStream.getTracks().forEach(function (track) { return track.stop(); });
            this._processedStream = null;
            this._processor.destroyProcessedStream(processedStream);
            this._audioProcessorEventObserver.emit('destroy');
        }
    };
    /**
     * Get the index of an un-labeled Device.
     * @param mediaDeviceInfo
     * @returns The index of the passed MediaDeviceInfo
     */
    AudioHelper.prototype._getUnknownDeviceIndex = function (mediaDeviceInfo) {
        var id = mediaDeviceInfo.deviceId;
        var kind = mediaDeviceInfo.kind;
        var index = this._unknownDeviceIndexes[kind][id];
        if (!index) {
            index = Object.keys(this._unknownDeviceIndexes[kind]).length + 1;
            this._unknownDeviceIndexes[kind][id] = index;
        }
        return index;
    };
    /**
     * Initialize output device enumeration.
     */
    AudioHelper.prototype._initializeEnumeration = function () {
        var _this = this;
        if (!this._mediaDevices || !this._enumerateDevices) {
            throw new errors_1.NotSupportedError('Enumeration is not supported');
        }
        if (this._mediaDevices.addEventListener) {
            this._mediaDevices.addEventListener('devicechange', this._updateAvailableDevices);
        }
        this._updateAvailableDevices().then(function () {
            if (!_this.isOutputSelectionSupported) {
                return;
            }
            Promise.all([
                _this.speakerDevices.set('default'),
                _this.ringtoneDevices.set('default'),
            ]).catch(function (reason) {
                _this._log.warn("Warning: Unable to set audio output devices. " + reason);
            });
        });
    };
    /**
     * Route input stream to the processor if it exists
     */
    AudioHelper.prototype._maybeCreateProcessedStream = function (stream) {
        var _this = this;
        if (this._processor) {
            this._log.debug('Creating processed stream');
            return this._processor.createProcessedStream(stream).then(function (processedStream) {
                _this._processedStream = processedStream;
                _this._audioProcessorEventObserver.emit('create');
                return _this._processedStream;
            });
        }
        return Promise.resolve(stream);
    };
    /**
     * Set whether the sound is enabled or not
     * @param soundName
     * @param doEnable
     * @returns Whether the sound is enabled or not
     */
    AudioHelper.prototype._maybeEnableSound = function (soundName, doEnable) {
        if (typeof doEnable !== 'undefined') {
            this._enabledSounds[soundName] = doEnable;
        }
        return this._enabledSounds[soundName];
    };
    /**
     * Stop the tracks on the current input stream before replacing it with the passed stream.
     * @param stream - The new stream
     */
    AudioHelper.prototype._replaceStream = function (stream) {
        this._log.debug('Replacing with new stream.');
        if (this._selectedInputDeviceStream) {
            this._log.debug('Old stream detected. Stopping tracks.');
            this._stopSelectedInputDeviceStream();
        }
        this._selectedInputDeviceStream = stream;
    };
    /**
     * Restart the active streams
     */
    AudioHelper.prototype._restartStreams = function () {
        if (this.inputDevice && this._selectedInputDeviceStream) {
            this._log.debug('Restarting selected input device');
            return this._setInputDevice(this.inputDevice.deviceId, true);
        }
        if (this._defaultInputDeviceStream) {
            var defaultDevice = this.availableInputDevices.get('default')
                || Array.from(this.availableInputDevices.values())[0];
            this._log.debug('Restarting default input device, now becoming selected.');
            return this._setInputDevice(defaultDevice.deviceId, true);
        }
        return Promise.resolve();
    };
    /**
     * Replace the current input device with a new device by ID.
     * @param deviceId - An ID of a device to replace the existing
     *   input device with.
     * @param forceGetUserMedia - If true, getUserMedia will be called even if
     *   the specified device is already active.
     */
    AudioHelper.prototype._setInputDevice = function (deviceId, forceGetUserMedia) {
        var _this = this;
        if (typeof deviceId !== 'string') {
            return Promise.reject(new errors_1.InvalidArgumentError('Must specify the device to set'));
        }
        var device = this.availableInputDevices.get(deviceId);
        if (!device) {
            return Promise.reject(new errors_1.InvalidArgumentError("Device not found: " + deviceId));
        }
        this._log.debug('Setting input device. ID: ' + deviceId);
        if (this._inputDevice && this._inputDevice.deviceId === deviceId && this._selectedInputDeviceStream) {
            if (!forceGetUserMedia) {
                return Promise.resolve();
            }
            // If the currently active track is still in readyState `live`, gUM may return the same track
            // rather than returning a fresh track.
            this._log.debug('Same track detected on setInputDevice, stopping old tracks.');
            this._stopSelectedInputDeviceStream();
        }
        // Release the default device in case it was created previously
        this._stopDefaultInputDeviceStream();
        var constraints = { audio: Object.assign({ deviceId: { exact: deviceId } }, this.audioConstraints) };
        this._log.debug('setInputDevice: getting new tracks.');
        return this._getUserMedia(constraints).then(function (originalStream) {
            _this._destroyProcessedStream();
            return _this._maybeCreateProcessedStream(originalStream).then(function (newStream) {
                _this._log.debug('setInputDevice: invoking _onActiveInputChanged.');
                return _this._onActiveInputChanged(newStream).then(function () {
                    _this._replaceStream(originalStream);
                    _this._inputDevice = device;
                    _this._maybeStartPollingVolume();
                });
            });
        });
    };
    /**
     * Stop the selected audio stream
     */
    AudioHelper.prototype._stopSelectedInputDeviceStream = function () {
        if (this._selectedInputDeviceStream) {
            this._log.debug('Stopping selected device stream');
            this._selectedInputDeviceStream.getTracks().forEach(function (track) { return track.stop(); });
        }
    };
    /**
     * Update a set of devices.
     * @param updatedDevices - An updated list of available Devices
     * @param availableDevices - The previous list of available Devices
     * @param removeLostDevice - The method to call if a previously available Device is
     *   no longer available.
     */
    AudioHelper.prototype._updateDevices = function (updatedDevices, availableDevices, removeLostDevice) {
        var _this = this;
        var updatedDeviceIds = updatedDevices.map(function (d) { return d.deviceId; });
        var knownDeviceIds = Array.from(availableDevices.values()).map(function (d) { return d.deviceId; });
        var lostActiveDevices = [];
        // Remove lost devices
        var lostDeviceIds = util_1.difference(knownDeviceIds, updatedDeviceIds);
        lostDeviceIds.forEach(function (lostDeviceId) {
            var lostDevice = availableDevices.get(lostDeviceId);
            if (lostDevice) {
                availableDevices.delete(lostDeviceId);
                if (removeLostDevice(lostDevice)) {
                    lostActiveDevices.push(lostDevice);
                }
            }
        });
        // Add any new devices, or devices with updated labels
        var deviceChanged = false;
        updatedDevices.forEach(function (newDevice) {
            var existingDevice = availableDevices.get(newDevice.deviceId);
            var newMediaDeviceInfo = _this._wrapMediaDeviceInfo(newDevice);
            if (!existingDevice || existingDevice.label !== newMediaDeviceInfo.label) {
                availableDevices.set(newDevice.deviceId, newMediaDeviceInfo);
                deviceChanged = true;
            }
        });
        if (deviceChanged || lostDeviceIds.length) {
            // Force a new gUM in case the underlying tracks of the active stream have changed. One
            //   reason this might happen is when `default` is selected and set to a USB device,
            //   then that device is unplugged or plugged back in. We can't check for the 'ended'
            //   event or readyState because it is asynchronous and may take upwards of 5 seconds,
            //   in my testing. (rrowland)
            if (this.inputDevice !== null && this.inputDevice.deviceId === 'default') {
                this._log.warn("Calling getUserMedia after device change to ensure that the           tracks of the active device (default) have not gone stale.");
                this._setInputDevice(this.inputDevice.deviceId, true);
            }
            this.emit('deviceChange', lostActiveDevices);
        }
    };
    /**
     * Disconnect the old input volume source, and create and connect a new one with the current
     * input stream.
     */
    AudioHelper.prototype._updateVolumeSource = function () {
        if (!this.inputStream || !this._audioContext || !this._inputVolumeAnalyser) {
            return;
        }
        if (this._inputVolumeSource) {
            this._inputVolumeSource.disconnect();
        }
        try {
            this._inputVolumeSource = this._audioContext.createMediaStreamSource(this.inputStream);
            this._inputVolumeSource.connect(this._inputVolumeAnalyser);
        }
        catch (ex) {
            this._log.warn('Unable to update volume source', ex);
            delete this._inputVolumeSource;
        }
    };
    /**
     * Convert a MediaDeviceInfo to a IMediaDeviceInfoShim.
     * @param mediaDeviceInfo - The info to convert
     * @returns The converted shim
     */
    AudioHelper.prototype._wrapMediaDeviceInfo = function (mediaDeviceInfo) {
        var options = {
            deviceId: mediaDeviceInfo.deviceId,
            groupId: mediaDeviceInfo.groupId,
            kind: mediaDeviceInfo.kind,
            label: mediaDeviceInfo.label,
        };
        if (!options.label) {
            if (options.deviceId === 'default') {
                options.label = 'Default';
            }
            else {
                var index = this._getUnknownDeviceIndex(mediaDeviceInfo);
                options.label = "Unknown " + kindAliases[options.kind] + " Device " + index;
            }
        }
        return new mediadeviceinfo_1.default(options);
    };
    return AudioHelper;
}(events_1.EventEmitter));
(function (AudioHelper) {
})(AudioHelper || (AudioHelper = {}));
exports.default = AudioHelper;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaW9oZWxwZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9saWIvdHdpbGlvL2F1ZGlvaGVscGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7OztBQUFBOzs7R0FHRztBQUNILGlDQUFzQztBQUd0QyxtQ0FBOEI7QUFDOUIsbUNBQW1FO0FBQ25FLDZCQUF3QjtBQUN4QixtRUFBOEQ7QUFDOUQsMkRBQTBEO0FBQzFELCtCQUF3RDtBQUV4RDs7O0dBR0c7QUFDSCxJQUFNLFdBQVcsR0FBMkI7SUFDMUMsVUFBVSxFQUFFLGFBQWE7SUFDekIsV0FBVyxFQUFFLGNBQWM7Q0FDNUIsQ0FBQztBQUVGOzs7R0FHRztBQUNIO0lBQTBCLCtCQUFZO0lBZ0twQzs7Ozs7O09BTUc7SUFDSCxxQkFBWSxzQkFBNEYsRUFDNUYsb0JBQW1FLEVBQ25FLE9BQTZCOztRQUZ6QyxZQUdFLGlCQUFPLFNBc0VSO1FBMU9EOztXQUVHO1FBQ0gsMkJBQXFCLEdBQWlDLElBQUksR0FBRyxFQUFFLENBQUM7UUFFaEU7O1dBRUc7UUFDSCw0QkFBc0IsR0FBaUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQTBDakU7O1dBRUc7UUFDSyx1QkFBaUIsR0FBaUMsSUFBSSxDQUFDO1FBWS9EOzs7OztXQUtHO1FBQ0ssK0JBQXlCLEdBQXVCLElBQUksQ0FBQztRQUU3RDs7V0FFRztRQUNLLG9CQUFjO1lBQ3BCLEdBQUMsZ0JBQU0sQ0FBQyxTQUFTLENBQUMsVUFBVSxJQUFHLElBQUk7WUFDbkMsR0FBQyxnQkFBTSxDQUFDLFNBQVMsQ0FBQyxRQUFRLElBQUcsSUFBSTtZQUNqQyxHQUFDLGdCQUFNLENBQUMsU0FBUyxDQUFDLFFBQVEsSUFBRyxJQUFJO2dCQUNqQztRQVlGOztXQUVHO1FBQ0ssa0JBQVksR0FBMkIsSUFBSSxDQUFDO1FBWXBEOztXQUVHO1FBQ0ssMkJBQXFCLEdBQVksS0FBSyxDQUFDO1FBRS9DOztXQUVHO1FBQ0ssVUFBSSxHQUFRLGFB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