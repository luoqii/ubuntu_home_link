/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const { merge } = require("sdk/util/object");
const self = require("sdk/self");
const panels = require("sdk/panel");
const timers = require("sdk/timers");
const tabs = require("sdk/tabs");
const windows = require("sdk/windows").browserWindows;
const prefs = require("./prefs");
const windowUtils = require("sdk/window/utils");
const simplePrefs = require('sdk/simple-prefs');
const getActiveView = require('sdk/view/core').getActiveView;

var vdhPanels = {};
var vdhPanelData = {};

exports.togglePanel = function(panelName, options) {

	function GetShowOpts(height) {
		var panelGeometry = PanelGeometry(height);
		var showOpts = options.showOpts();
		showOpts.width = showOpts.width || panelGeometry.width;
		showOpts.height = showOpts.height || panelGeometry.height;
		if(!showOpts.position) 
			showOpts.position = {
				top: panelGeometry.top,
				left: panelGeometry.left,
			}
		if(options.top!==undefined)
			showOpts.position.top = options.top;
		return showOpts;
	}

	var options = merge({
		showOpts: function() { return {} },
		estimatedHeight: 300,
		lang: null,
		contentURL: null,
		jsFiles: [],
		onShow: function() {},
		onHide: function() {},
		onCreate: function() {},
		onDelete: function() {},
		onMessage: function() {},
		closeTimeout: 60000,
		closeTimer: null,
		prefs: true,
		type: "panel",
	},options || {});
	
	var jsFiles = [
	    self.data.url("lib/angular.min.js"),
	    self.data.url("lib/angular-animate.min.js"),
	    self.data.url("commonPanel.js"),
	];
	if(!Array.isArray(options.jsFiles))
		options.jsFiles = [ options.jsFiles ];
	options.jsFiles.forEach(function(jsFile) {
		jsFiles.push(self.data.url(jsFile));
	});
	var l10nData = require("./l10n-data");
	options.lang = l10nData.bestMatchingLocale;

	function HandlePanel() {
		var vdhPanel = vdhPanels[panelName];
		 
		if(vdhPanel) {
			if(vdhPanel.isShowing)
				vdhPanel.hide();
			else {
				var showOpts = GetShowOpts();//options.showOpts();
				vdhPanel.show(showOpts);
			}
		} else {
			vdhPanel = panels.Panel({		
				contentURL: self.data.url(options.contentURL),
				contentScriptOptions: {
					l10nData: l10nData.hash,
					initData: vdhPanelData[panelName] || null, 
				},
				contentScriptFile: jsFiles,
				onHide: function() {
					options.closeTimer = timers.setTimeout(function() {
						try {
							vdhPanel.port.emit("contentMessage",{
								type: "close",
							});
						} catch($_) {}
						options.onDelete();
						delete vdhPanels[panelName];
					},options.closeTimeout);
					options.onHide(vdhPanel);
				},
				onShow: function() {
	
					if(options.closeTimer) {
						timers.clearTimeout(options.closeTimer);
						options.closeTimer = null;
					}
					var l10nData = require("./l10n-data");
					if(options.lang != l10nData.bestMatchingLocale) { // language has changed
						options.lang = l10nData.bestMatchingLocale;
						vdhPanel.port.emit("contentMessage",{
							type: "strings",
							strings: l10nData.hash,
						});
					}
					vdhPanel.port.emit("contentMessage",{
						type: "openPanel",
					});
					options.onShow(vdhPanel);
				},
				onMessage: function(message) {
					switch(message.type) {
					case "updateGeometry":
						var panelGeometry = PanelGeometry(message.height);
						var showOpts = GetShowOpts(message.height);
						vdhPanel.resize(panelGeometry.width, panelGeometry.height);
						break;
					case "setPrefs":
						prefs.set(message.prefs);
						break;
					case "closed":
						vdhPanel.destroy();
						break;
					default:
						options.onMessage(message,vdhPanel);
					}
				},
			});
			var showOpts = GetShowOpts(options.estimatedHeight);
			vdhPanel.show(showOpts);
			
			var activeView = getActiveView(vdhPanel); 
			
			activeView.setAttribute('tooltip', 'aHTMLTooltip');
			
			vdhPanels[panelName] = vdhPanel;
			if(options.prefs)
				vdhPanel.port.emit("contentMessage",{
					type: "set",
					name: "prefs",
					value: prefs.prefs,
				});
			options.onCreate(vdhPanel);
		}
	}
	
	function HandleTab() {
		var url = self.data.url(options.contentURL);
		for(var tabId in tabs) {
			var tab = tabs[tabId];
			if(tab.url == url) {
				tab.activate();
				if(tab.window != windows.activeWindow)
					tab.window.activate();
				return;
			}
		}
		tabs.open({
			url: url,
			onReady: function(tab) {
				
				var worker = tab.attach({
					contentScriptOptions: {
						l10nData: l10nData.hash,
						initData: vdhPanelData[panelName] || null, 
					},
					contentScriptFile: jsFiles,
					onMessage: function(message) {
						switch(message.type) {
						case "updateGeometry":
							break;
						case "setPrefs":
							prefs.set(message.prefs);
							break;
						case "closed":
							break;
						default:
							options.onMessage(message,worker);
						}
					},
				});
				tab.on("close",function() {
					options.onHide(worker);
					options.onDelete();
					delete vdhPanels[panelName];
				});
				vdhPanels[panelName] = worker;
				if(options.prefs)
					worker.port.emit("contentMessage",{
						type: "set",
						name: "prefs",
						value: prefs.prefs,
					});
				options.onCreate(worker);
				worker.port.emit("contentMessage",{
					type: "openPanel",
				});
				options.onShow(worker);
			},
		});
	}
	
	if(options.type=="panel")
		HandlePanel();
	else if(options.type=="tab")
		HandleTab();
}

exports.panelData = function(panelName,varName,varValue) {
	var panelData = vdhPanelData[panelName];
	if(!panelData) {
		panelData = {};
		vdhPanelData[panelName] = panelData;
	}
	if(!Array.isArray(varName))
		varName = [ varName ];
	var target = panelData;
	for(var i=0;i<varName.length-1;i++) {
		var field = varName[i];
		if(target[field]===undefined)
			target[field] = {};
		target = target[field];
	}
	target[varName[varName.length-1]] = varValue;
	var panel = vdhPanels[panelName];
	if(panel)
		panel.port.emit("contentMessage",{
			type: "set",
			name: varName,
			value: varValue,
		});
}

exports.deletePanelData = function(panelName,varName) {
	var panelData = vdhPanelData[panelName];
	if(!panelData)
		return;
	if(!Array.isArray(varName))
		varName = [ varName ];
	var target = panelData;
	for(var i=0;i<varName.length-1;i++) {
		var field = varName[i];
		if(target[field]===undefined)
			return;
	}
	delete target[varName[varName.length-1]];
	var panel = vdhPanels[panelName];
	if(panel)
		panel.port.emit("contentMessage",{
			type: "set",
			name: varName.slice(-1),
			value: target,
		});
}

exports.openPanel = function(panelName, options) {
	var vdhPanel = vdhPanels[panelName];
	if(vdhPanel && vdhPanel.isShowing)
		exports.togglePanel(panelName);
	exports.togglePanel(panelName,options);
}

exports.hidePanel = function(panelName) {
	var vdhPanel = vdhPanels[panelName];
	if(vdhPanel && vdhPanel.isShowing)
		exports.togglePanel(panelName);
}

function UpdatePref(key,value) {
	for(var i in vdhPanels) {
		var panel = vdhPanels[i];
		try {
			panel.port.emit('contentMessage',{
				type: "set",
				name: ["prefs",key],
				value: value,
			});
		} catch($_) {}
	}
}

prefs.addListener(UpdatePref);

function WindowSize() {
	var currentWindow = windowUtils.getMostRecentBrowserWindow();
	if(currentWindow)
		return {
			width: currentWindow.outerWidth,
			height: currentWindow.outerHeight,
		}
	else
		return {
			width: 1280,
			height: 800,
		}
}

function PanelGeometry(height) {
	var winSize = WindowSize();
	var width = Math.max(simplePrefs.prefs['max-panel-width'],Math.min(simplePrefs.prefs['min-panel-width'],winSize.width));
	return {
		width: width,
		height: height,
		top: Math.max(0,(winSize.height-height)/2),
		left: Math.max(0,(winSize.width-width)/2),
	}
}

require("sdk/system/unload").when(function() {
	prefs.removeListener(UpdatePref);
	for(var i in vdhPanels)
		vdhPanels[i].destroy();
});

