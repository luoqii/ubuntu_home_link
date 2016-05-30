/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const vdhPanels = require("./panels");
const simplePrefs = require('sdk/simple-prefs');
const tabs = require("sdk/tabs");

const smartnames = require("./smartnames");
const variants = require("./variants");
const blacklist = require("./blacklist");
const safeMode = require("./safemode");
const actions = require("./actions");


function ToggleSettingsPanel() {
	vdhPanels.togglePanel('settings',{
		top: 10,
		type: simplePrefs.prefs["panels.astab.settings"]?"tab":"panel",
		contentURL: "settingsPanel.html",
		jsFiles: [
		    "lib/jquery.min.js",
		    "lib/bootstrap/bootstrap.min.js",
		    "settingsPanel.js",
		],
		onShow: function(panel) {
			/* @+firefox */
			if(!simplePrefs.prefs['storagedirectory']) {
				var currentWindow = require("sdk/window/utils").getMostRecentBrowserWindow();
				simplePrefs.prefs['storagedirectory'] = 
					actions.getDownloadDirectory(require("sdk/private-browsing").isPrivate(currentWindow)).path;
			}
			/* @- */
			var converter = require("./converter");
			panel.port.emit("contentMessage",{
				type: "set",
				name: "smartnames",
				value: smartnames.getAll(),
			});
			/* @+firefox */
			panel.port.emit("contentMessage",{
				type: "set",
				name: "variants",
				value: variants.getVariantsList(),
			});
			panel.port.emit("contentMessage",{
				type: "set",
				name: "adpVariants",
				value: variants.getAdpVariantsList(),
			});
			/* @- */
			panel.port.emit("contentMessage",{
				type: "set",
				name: "blacklist",
				value: blacklist.getAllDomains(),
			});
			/* @+firefox */
			panel.port.emit("contentMessage",{
				type: "set",
				name: "platform",
				value: require("sdk/system").platform,
			});
			panel.port.emit("contentMessage",{
				type: "set",
				name: "transientStorageDirectory",
				value: actions.transientStorageDirectory(),
			});
			panel.port.emit("contentMessage",{
				type: "set",
				name: "browserDownloadLastDir",
				value: actions.getBrowserDownloadLastDir(),
			});
			converter.status(function() {
				panel.port.emit("contentMessage",{
					type: "set",
					name: "converter",
					value: converter.config(),
				});
			});
			/* @- */
		},
		onMessage: function(message,panel) {
			var converter = require("./converter");
			switch(message.type) {
			case "smartnames":
				smartnames.set(message.smartnames);
				break;
			case "blacklist":
				blacklist.updateDomains(message.blacklist);
				break;
			case "variants":
				variants.setVariantsList(message.variants);
				break;
			case "adpVariants":
				variants.setAdpVariantsList(message.variants);
				break;
			case "resetVariants":
				variants.resetVariants();
				panel.port.emit("contentMessage",{
					type: "set",
					name: "variants",
					value: variants.getVariantsList(),
				});
				panel.port.emit("contentMessage",{
					type: "set",
					name: "adpVariants",
					value: variants.getAdpVariantsList(),
				});
				break;
			case "orderAdpVariants":
				variants.orderAdaptative();
				panel.port.emit("contentMessage",{
					type: "set",
					name: "adpVariants",
					value: variants.getAdpVariantsList(),
				});
				break;
			case "checkConverter":
				converter.check(function() {
					panel.port.emit("contentMessage",{
						type: "set",
						name: "converter",
						value: converter.config(),
					});					
				});
				break;
			/* @+firefox */
			case "updateConverter":
				if(typeof panel.hide=="function")
					panel.hide();
				tabs.open({
					url: message.url,
				});
				break;
			/* @- */
			case "deleteRule":
				converter.deleteRule(message.index);
				panel.port.emit("contentMessage",{
					type: "set",
					name: "converter",
					value: converter.config(),
				});
				break;
			case "resetConverterRules":
				converter.resetRules();
				panel.port.emit("contentMessage",{
					type: "set",
					name: "converter",
					value: converter.config(),
				});
				break;
			case "resetConfigs":
				converter.resetConfigs(message.configs);
				panel.port.emit("contentMessage",{
					type: "set",
					name: "converter",
					value: converter.config(),
				});
				break;
			case "updateRules":
				converter.updateRules(message.rules);
				break;
			case "setConfigs":
				converter.setConfigs(message.configs);
				break;
			case "installConverter":
				if(typeof panel.hide=="function")
					panel.hide();
				tabs.open({
					url: "http://www.downloadhelper.net/install-converter3.php",
				});
				break;
			case "conversionHelp":
				if(typeof panel.hide=="function")
					panel.hide();
				tabs.open({
					url: "http://www.downloadhelper.net/conversion-manual3.php",
				});
				break;
			case "getLicenseKey":
				if(typeof panel.hide=="function")
					panel.hide();
				tabs.open({
					url: "http://www.downloadhelper.net/convert.php",
				});
				break;
			case "validateLicense":
				converter.checkLicense(message.key,function() {
					panel.port.emit("contentMessage",{
						type: "set",
						name: "converter",
						value: converter.config(),
					});										
				});
				break;
			case "changeStorageDirectory":
				var currentWindow = require("sdk/window/utils").getMostRecentBrowserWindow();
				actions.changeStorageDirectory(require("sdk/private-browsing").isPrivate(currentWindow),ToggleSettingsPanel);
				break;
			case "gotoDonation":
				if(typeof panel.hide=="function")
					panel.hide();
				tabs.open({
					url: "http://www.downloadhelper.net/donate.php",
				});
				break;
			case "gotoJocly":
				if(typeof panel.hide=="function")
					panel.hide();
				tabs.open({
					url: "https://addons.mozilla.org/firefox/addon/jocly/",
				});
				break;
			case "setSafe":
                if(typeof panel.hide=="function")
                    panel.hide();
				safeMode.setSafe();
				break;
			/* @+firefox */
			case "getMaskedPassword":
				require('./masked').getPassword(function(password) {
					panel.port.emit("contentMessage",{
						type: "set",
						name: "maskedPassword",
						value: password,
					});
				});
				break;
			case "setMaskedPassword":
				require('./masked').setPassword(message.password);
				break;
			/* @- */
			}
		},
	});
}
simplePrefs.on("settings",ToggleSettingsPanel);

exports.toggle = ToggleSettingsPanel;
