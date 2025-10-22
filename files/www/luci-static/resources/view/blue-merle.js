'use strict';
'require view';
'require fs';
'require ui';
'require rpc';

var css = '								\
	.controls {							\
		display: flex;					\
		margin: .5em 0 1em 0;			\
		flex-wrap: wrap;				\
		justify-content: space-around;	\
	}									\
										\
	.controls > * {						\
		padding: .25em;					\
		white-space: nowrap;			\
		flex: 1 1 33%;					\
		box-sizing: border-box;			\
		display: flex;					\
		flex-wrap: wrap;				\
	}									\
										\
	.controls > *:first-child,			\
	.controls > * > label {				\
		flex-basis: 100%;				\
		min-width: 250px;				\
	}									\
										\
	.controls > *:nth-child(2),			\
	.controls > *:nth-child(3) {		\
		flex-basis: 20%;				\
	}									\
										\
	.controls > * > .btn {				\
		flex-basis: 20px;				\
		text-align: center;				\
	}									\
										\
	.controls > * > * {					\
		flex-grow: 1;					\
		align-self: center;				\
	}									\
										\
	.controls > div > input {			\
		width: auto;					\
	}									\
										\
	.td.version,						\
	.td.size {							\
		white-space: nowrap;			\
	}									\
										\
	ul.deps, ul.deps ul, ul.errors {	\
		margin-left: 1em;				\
	}									\
										\
	ul.deps li, ul.errors li {			\
		list-style: none;				\
	}									\
										\
	ul.deps li:before {					\
		content: "↳";					\
		display: inline-block;			\
		width: 1em;						\
		margin-left: -1em;				\
	}									\
										\
	ul.deps li > span {					\
		white-space: nowrap;			\
	}									\
										\
	ul.errors li {						\
		color: #c44;					\
		font-size: 90%;					\
		font-weight: bold;				\
		padding-left: 1.5em;			\
	}									\
										\
	ul.errors li:before {				\
		content: "⚠";					\
		display: inline-block;			\
		width: 1.5em;					\
		margin-left: -1.5em;			\
	}									\
										\
	.mac-settings-container {			\
		display: flex;					\
		flex-wrap: wrap;				\
		gap: 1em;						\
		align-items: flex-start;			\
		margin: 1em 0;					\
	}									\
										\
	.mac-options {						\
		flex: 2 1 320px;				\
		display: flex;					\
		flex-direction: column;			\
		gap: .75em;						\
	}									\
										\
	.mac-option {						\
		display: flex;					\
		flex-direction: column;			\
		gap: .35em;						\
		background: rgba(0,0,0,.03);	\
		padding: .75em;					\
		border-radius: 6px;				\
	}									\
										\
	.mac-option-label {				\
		font-weight: 600;				\
	}									\
										\
	.mac-option .control-group {		\
		display: flex;					\
		align-items: center;				\
		gap: .5em;						\
	}									\
										\
	.mac-option textarea {				\
		width: 100%;					\
		resize: vertical;				\
		min-height: 5.5em;				\
	}									\
										\
	.mac-apply-btn {					\
		align-self: flex-start;			\
		padding: .35em .9em;			\
		font-size: 90%;					\
	}									\
										\
	.mac-status-card {					\
		flex: 1 1 220px;				\
		min-width: 220px;				\
	}									\
										\
	.mac-status-card h4 {				\
		margin: 0 0 .5em 0;				\
	}									\
										\
	.mac-status-table {					\
		width: 100%;					\
		border-collapse: collapse;		\
		font-size: 90%;					\
	}									\
										\
	.mac-status-table th,				\
	.mac-status-table td {				\
		border-bottom: 1px solid #ddd;	\
		padding: .35em .5em;			\
		text-align: left;				\
		word-break: break-all;			\
	}									\
										\
	.mac-status-table tr:last-child td {\
		border-bottom: none;			\
	}									\
';

var isReadonlyView = !L.hasViewPermission() || null;

var callMountPoints = rpc.declare({
	object: 'luci',
	method: 'getMountPoints',
	expect: { result: [] }
});

var packages = {
	available: { providers: {}, pkgs: {} },
	installed: { providers: {}, pkgs: {} }
};

var languages = ['en'];

var currentDisplayMode = 'available', currentDisplayRows = [];

var macTargetDefinitions = [
	{ key: 'wireless0', uci: 'wireless.@wifi-iface[0].macaddr' },
	{ key: 'wireless1', uci: 'wireless.@wifi-iface[1].macaddr' },
	{ key: 'network',   uci: 'network.@device[1].macaddr' },
	{ key: 'macclone',  uci: 'glconfig.general.macclone_addr' }
];



function handleReset(ev)
{
}


function callBlueMerle() {
    const cmd = "/usr/libexec/blue-merle";
    var args = Array.prototype.slice.call(arguments);
    var prom = fs.exec(cmd, args);
    return prom.then(
        function(res) {
            console.log("Blue Merle args", args, "res", res);
            if (res.code != 0) {
                throw new Error("Return code " + res.code);
            } else {
                return (res.stdout || '').trim();
            }
        }
    ).catch(
        function(err) {
            console.log("Error calling Blue Merle", args, err);
            throw err;
        }
    );
}

function readIMEI() {
    return callBlueMerle("read-imei");
}

function randomIMEI() {
    callBlueMerle("random-imei").then(
        function(res){
            readIMEI().then(
                console.log("new IMEI", imei)
            );
        }
    ).catch(
        function(err){
            console.log("Error", err);
        }
    );
}

function readIMSI() {
    return callBlueMerle("read-imsi");
}

function handleConfig(ev)
{
	var conf = {};

        const cmd = "/usr/libexec/blue-merle";
		var dlg = ui.showModal(_('Executing blue merle'), [
			E('p', { 'class': 'spinning' },
				_('Waiting for the <em>%h</em> command to complete…').format(cmd))
		]);

        var argv = ["random-imei"];
        console.log("Calling ", cmd, argv);
        // FIXME: Investigate whether we should be using fs.exec()
		fs.exec_direct(cmd, argv, 'text').then(function(res) {
		    console.log("Res:", res, "stdout", res.stdout, "stderr", res.stderr, "code", res.code);

			if (res.stdout)
				dlg.appendChild(E('pre', [ res.stdout ]));

			if (res.stderr) {
				dlg.appendChild(E('h5', _('Errors')));
				dlg.appendChild(E('pre', { 'class': 'errors' }, [ res.stderr ]));
			}

			console.log("Res.code: ", res.code);
			if (res.code !== 0)
				dlg.appendChild(E('p', _('The <em>%h %h</em> command failed with code <code>%d</code>.').format(cmd, argv, (res.code & 0xff) || -1)));

			dlg.appendChild(E('div', { 'class': 'right' },
				E('div', {
					'class': 'btn',
					'click': L.bind(function(res) {
						if (ui.menu && ui.menu.flushCache)
							ui.menu.flushCache();

						ui.hideModal();

						if (res.code !== 0)
							rejectFn(new Error(res.stderr || 'opkg error %d'.format(res.code)));
						else
							resolveFn(res);
					}, this, res)
				}, _('Dismiss'))));
		}).catch(function(err) {
			ui.addNotification(null, E('p', _('Unable to execute <em>opkg %s</em> command: %s').format(cmd, err)));
			ui.hideModal();
		});



	fs.list('/etc/opkg').then(function(partials) {
		var files = [ '/etc/opkg.conf' ];

		for (var i = 0; i < partials.length; i++)
			if (partials[i].type == 'file' && partials[i].name.match(/\.conf$/))
				files.push('/etc/opkg/' + partials[i].name);

		return Promise.all(files.map(function(file) {
			return fs.read(file)
				.then(L.bind(function(conf, file, res) { conf[file] = res }, this, conf, file))
				.catch(function(err) {
				});
		}));
	}).then(function() {
		var body = [
			E('p', {}, _('Below is a listing of the various configuration files used by <em>opkg</em>. Use <em>opkg.conf</em> for global settings and <em>customfeeds.conf</em> for custom repository entries. The configuration in the other files may be changed but is usually not preserved by <em>sysupgrade</em>.'))
		];

		Object.keys(conf).sort().forEach(function(file) {
			body.push(E('h5', {}, '%h'.format(file)));
			body.push(E('textarea', {
				'name': file,
				'rows': Math.max(Math.min(L.toArray(conf[file].match(/\n/g)).length, 10), 3)
			}, '%h'.format(conf[file])));
		});

		body.push(E('div', { 'class': 'right' }, [
			E('div', {
				'class': 'btn cbi-button-neutral',
				'click': ui.hideModal
			}, _('Cancel')),
			' ',
			E('div', {
				'class': 'btn cbi-button-positive',
				'click': function(ev) {
					var data = {};
					findParent(ev.target, '.modal').querySelectorAll('textarea[name]')
						.forEach(function(textarea) {
							data[textarea.getAttribute('name')] = textarea.value
						});

					ui.showModal(_('OPKG Configuration'), [
						E('p', { 'class': 'spinning' }, _('Saving configuration data…'))
					]);

					Promise.all(Object.keys(data).map(function(file) {
						return fs.write(file, data[file]).catch(function(err) {
							ui.addNotification(null, E('p', {}, [ _('Unable to save %s: %s').format(file, err) ]));
						});
					})).then(ui.hideModal);
				},
				'disabled': isReadonlyView
			}, _('Save')),
		]));

		//ui.showModal(_('OPKG Configuration'), body);
	});
}

function handleShutdown(ev)
{
    return callBlueMerle("shutdown")
}

function handleRemove(ev)
{
}

function handleSimSwap(ev) {
    const spinnerID = 'swap-spinner-id';
	var dlg = ui.showModal(_('Starting SIM swap...'),
	    [
			E('p', { 'class': 'spinning', 'id': spinnerID },
				_('Shutting down modem…')
			 )
		]
	);
    callBlueMerle("shutdown-modem").then(
        function(res) {
            dlg.appendChild(
                E('pre', { 'class': 'result'},
                    res
                )
            );
            dlg.appendChild(
                E('p', { 'class': 'text'},
                    _("Generating Random IMEI")
                )
            );
            callBlueMerle("random-imei").then(
                function(res) {
                    document.getElementById(spinnerID).style = "display:none";
                    dlg.appendChild(
                        E('div', { 'class': 'text'},
                          [
                            E('p', { 'class': 'text'},
                                _("IMEI set:") + " " + res
                            ),
                            E('p', { 'class': 'text'},
                                _("Please shutdown the device, swap the SIM, then go to another place before booting")
                            ),
    			    		E('button', { 'class': 'btn cbi-button-positive', 'click': handleShutdown, 'disabled': isReadonlyView },
    				    	    [ _('Shutdown…') ]
                            )
                          ]
                        )
                    )
                }
            ).catch(
                function(err) {
                    dlg.appendChild(
                        E('p',{'class': 'error'},
                            _('Error setting IMEI! ') + err
                        )
                    )
                }
            );
        }
    ).catch(
        function(err) {
            dlg.appendChild(
                E('p',{'class': 'error'},
                    _('Error! ') + err
                )
            )
        }
    );
}

function handleOpkg(ev)
{
}

function handleUpload(ev)
{
}


function handleInput(ev) {
}

function readMacConfig() {
    return callBlueMerle("mac-config").then(function(res) {
        if (!res)
            return {};

        try {
            return JSON.parse(res);
        } catch (err) {
            console.warn('Unable to parse mac-config payload', res, err);
            return {};
        }
    });
}

function applyMacSettings(mode, value) {
    return callBlueMerle("apply-mac", mode, value).then(function(res) {
        if (!res)
            return {};

        try {
            return JSON.parse(res);
        } catch (err) {
            throw new Error(_('Unexpected response while applying MAC settings.'));
        }
    });
}

function readCurrentMacs() {
	return callBlueMerle("mac-status").then(function(res) {
		if (!res)
			return {};

		try {
			return JSON.parse(res);
		} catch (err) {
			console.warn('Unable to parse mac-status payload', res, err);
			return {};
		}
	});
}

return view.extend({
	load: function() {
	},

	render: function(listData) {
		var query = decodeURIComponent(L.toArray(location.search.match(/\bquery=([^=]+)\b/))[1] || '');

        const imeiInputID = 'imei-input';
        const imsiInputID = 'imsi-input';
        const macVendorRadioID = 'mac-mode-vendor';
        const macVendorInputID = 'mac-vendor-input';
        const macRandomRadioID = 'mac-mode-random';
        const macExplicitRadioID = 'mac-mode-explicit';
        const macExplicitInputID = 'mac-explicit-input';
        const macApplyButtonID = 'mac-apply-button';
        const macStatusTableID = 'mac-status-table';
        const macStatusConfig = [
            { key: 'wireless0', label: _('Wi-Fi (2.4 GHz)') },
            { key: 'wireless1', label: _('Wi-Fi (5 GHz)') },
            { key: 'network', label: _('LAN device') },
            { key: 'macclone', label: _('Upstream clone') }
        ];

        function updateMacStatusTable(values) {
            var table = document.getElementById(macStatusTableID);
            if (!table)
                return;

            macStatusConfig.forEach(function(entry) {
                var cell = table.querySelector('tr[data-mac-key="' + entry.key + '"] td.mac-value');
                if (cell) {
                    var value = values && values[entry.key];
                    cell.textContent = value ? value : '--';
                }
            });
        }

        function updateMacModeState() {
            var vendorRadio = document.getElementById(macVendorRadioID);
            var vendorInput = document.getElementById(macVendorInputID);
            var randomRadio = document.getElementById(macRandomRadioID);
            var explicitRadio = document.getElementById(macExplicitRadioID);
            var explicitInput = document.getElementById(macExplicitInputID);

            if (!isReadonlyView && vendorRadio && !vendorRadio.checked &&
                !(explicitRadio && explicitRadio.checked) &&
                !(randomRadio && randomRadio.checked))
                vendorRadio.checked = true;

            if (vendorInput)
                vendorInput.disabled = !(vendorRadio && vendorRadio.checked);

            if (explicitInput)
                explicitInput.disabled = !(explicitRadio && explicitRadio.checked);
        }

        function handleMacModeChange(ev) {
            updateMacModeState();
        }

        function handleMacApply(ev) {
            ev.preventDefault();

            var selected = document.querySelector('input[name="mac-mode"]:checked');
            if (!selected) {
                ui.addNotification(null, E('p', {}, _('Please choose a MAC configuration option.')));
                return;
            }

            var mode = selected.value;
            var input = null;
            if (mode === 'vendor')
                input = document.getElementById(macVendorInputID);
            else if (mode === 'explicit')
                input = document.getElementById(macExplicitInputID);

            var data = (input ? input.value : '').trim();

            if ((mode === 'vendor' || mode === 'explicit') && !data) {
                ui.addNotification(null, E('p', {}, _('Please provide MAC data before applying.')));
                return;
            }

            ui.showModal(_('Applying MAC settings'), [
                E('p', { 'class': 'spinning' }, _('Updating configuration…'))
            ]);

            applyMacSettings(mode, data).then(function(result) {
                ui.hideModal();

                var assigned = result.assigned || {};
                updateMacStatusTable(assigned);
                readCurrentMacs().then(updateMacStatusTable);

                var details = Object.keys(assigned).map(function(key) {
                    return key + ': ' + assigned[key];
                }).join(', ');

                var note = ui.addNotification(_('MAC settings updated'), E('p', {}, details || _('Configuration saved.')));
                if (note) {
                    window.setTimeout(function() {
                        if (note.parentNode) {
                            note.parentNode.removeChild(note);
                        }
                    }, 5000);
                }
            }).catch(function(err) {
                ui.hideModal();
                ui.addNotification(_('MAC update failed'), E('p', {}, '' + err));
            });
        }

		var view = E([], [
			E('style', { 'type': 'text/css' }, [ css ]),

			E('h2', {}, _('Blue Merle')),

			E('div', { 'class': 'controls' }, [
				E('div', {}, [
					E('label', {}, _('IMEI') + ':'),
					E('span', { 'class': 'control-group' }, [
						E('input', { 'id':imeiInputID, 'type': 'text', 'name': 'filter', 'placeholder': _('e.g. 31428392718429'), 'minlength':14, 'maxlenght':14, 'required':true, 'value': query, 'input': handleInput, 'disabled': true })
						//, E('button', { 'class': 'btn cbi-button', 'click': handleReset }, [ _('Clear') ])
						//, E('button', { 'class': 'btn cbi-button', 'click': randomIMEI }, [ _('Set Random') ])
					])
				]),

				E('div', {}, [
					E('label', {}, _('IMSI') + ':'),
					E('span', { 'class': 'control-group' }, [
						E('input', { 'id':imsiInputID, 'type': 'text', 'name': 'filter', 'placeholder': _('e.g. 31428392718429'), 'minlength':14, 'maxlenght':14, 'required':true, 'value': query, 'input': handleInput, 'disabled': true })
						//, E('button', { 'class': 'btn cbi-button', 'click': handleReset }, [ _('Clear') ])
					])
				]),
			]),

			E('div', { 'class': 'mac-settings-container' }, [
				E('div', { 'class': 'mac-options' }, [
					E('div', { 'class': 'mac-option' }, [
						E('label', { 'class': 'mac-option-label', 'for': macVendorInputID }, _('Vendor OUI prefixes')),
						E('div', { 'class': 'control-group' }, [
							E('input', {
								'id': macVendorRadioID,
								'type': 'radio',
								'name': 'mac-mode',
								'value': 'vendor',
								'change': handleMacModeChange,
								'disabled': isReadonlyView
							}),
							E('label', { 'for': macVendorRadioID }, _('Generate with vendor bytes'))
						]),
						E('textarea', {
							'id': macVendorInputID,
							'rows': 3,
							'placeholder': _('One OUI per line, e.g. 00:11:22'),
							'disabled': true
						})
					]),

					E('div', { 'class': 'mac-option' }, [
						E('label', { 'class': 'mac-option-label', 'for': macExplicitInputID }, _('Explicit MAC choices')),
						E('div', { 'class': 'control-group' }, [
							E('input', {
								'id': macExplicitRadioID,
								'type': 'radio',
								'name': 'mac-mode',
								'value': 'explicit',
								'change': handleMacModeChange,
								'disabled': isReadonlyView
							}),
							E('label', { 'for': macExplicitRadioID }, _('Use provided MAC addresses'))
						]),
						E('textarea', {
							'id': macExplicitInputID,
							'rows': 3,
							'placeholder': _('One MAC per line, e.g. AA:BB:CC:DD:EE:FF'),
							'disabled': true
						})
					]),

					E('div', { 'class': 'mac-option' }, [
						E('label', { 'class': 'mac-option-label', 'for': macRandomRadioID }, _('Random MAC addresses')),
						E('div', { 'class': 'control-group' }, [
							E('input', {
								'id': macRandomRadioID,
								'type': 'radio',
								'name': 'mac-mode',
								'value': 'random',
								'change': handleMacModeChange,
								'disabled': isReadonlyView
							}),
							E('label', { 'for': macRandomRadioID }, _('Fully randomize each MAC address'))
						])
					]),

					E('div', { 'class': 'mac-option' }, [
						E('button', {
							'id': macApplyButtonID,
							'class': 'btn cbi-button-action mac-apply-btn',
							'click': handleMacApply,
							'disabled': isReadonlyView
						}, [ _('Apply MAC settings') ])
					])
				]),

				E('div', { 'class': 'mac-status-card' }, [
					E('h4', {}, _('Current MACs')),
					E('table', { 'class': 'mac-status-table', 'id': macStatusTableID }, [
						E('thead', {}, [
							E('tr', {}, [
								E('th', {}, _('Interface')),
								E('th', {}, _('MAC address'))
							])
						]),
						E('tbody', {},
							macStatusConfig.map(function(entry) {
								return E('tr', { 'data-mac-key': entry.key }, [
									E('td', {}, entry.label),
									E('td', { 'class': 'mac-value' }, '--')
								]);
							})
						)
					])
				])
			]),

			E('div', {}, [
				E('label', {}, _('Actions') + ':'), ' ',
				E('span', { 'class': 'control-group' }, [
					E('button', { 'class': 'btn cbi-button-positive', 'data-command': 'update', 'click': handleSimSwap, 'disabled': isReadonlyView }, [ _('SIM swap…') ]), ' '
					//, E('button', { 'class': 'btn cbi-button-action', 'click': handleUpload, 'disabled': isReadonlyView }, [ _('IMEI change…') ]), ' '
					//, E('button', { 'class': 'btn cbi-button-neutral', 'click': handleConfig }, [ _('Shred config…') ])
				])
			])

		]);

		readIMEI().then(
		    function(imei) {
		        const e = document.getElementById(imeiInputID);
		        console.log("Input: ", e, e.placeholder, e.value);
		        e.value = imei;
		    }
		).catch(
		    function(err){
		        console.log("Error: ", err)
		    }
		)

		readIMSI().then(
		    function(imsi) {
		        const e = document.getElementById(imsiInputID);
		        e.value = imsi;
		    }
		).catch(
		    function(err){
		        const e = document.getElementById(imsiInputID);
		        e.value = "No IMSI found";
		    }
		)

		readMacConfig().then(function(cfg) {
		    var vendorRadio = document.getElementById(macVendorRadioID);
		    var explicitRadio = document.getElementById(macExplicitRadioID);
		    var randomRadio = document.getElementById(macRandomRadioID);
		    var vendorInput = document.getElementById(macVendorInputID);
		    var explicitInput = document.getElementById(macExplicitInputID);

		    if (vendorInput && cfg.vendor)
		        vendorInput.value = cfg.vendor.replace(/\s+/g, '\n');

		    if (explicitInput && cfg.static)
		        explicitInput.value = cfg.static.replace(/\s+/g, '\n');

		    if (cfg.mode === 'explicit') {
		        if (explicitRadio)
		            explicitRadio.checked = true;
		    } else if (cfg.mode === 'random') {
		        if (randomRadio)
		            randomRadio.checked = true;
		    } else if (vendorRadio) {
		        vendorRadio.checked = true;
		    }

		    updateMacModeState();
		}).catch(function(err) {
		    console.warn('Unable to load MAC configuration', err);
		    updateMacModeState();
		});

		updateMacModeState();
		readCurrentMacs().then(updateMacStatusTable);

		return view;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
