/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const self = require("sdk/self");
const { Cc, Ci, Cu } = require("chrome");
const { ActionButton } = require("sdk/ui");
const _ = require("sdk/l10n").get;
const simplePrefs = require('sdk/simple-prefs');
const tabs = require("sdk/tabs");
const pageMod = require("sdk/page-mod");
const viewFor = require("sdk/view/core").viewFor;
const windows = require('sdk/windows').browserWindows;

const vdhPanels = require("./panels");
const prefs = require("./prefs");
const networkProbe = require("./network-probe");
const hits = require("./hits");
const actions = require("./actions");
const tbvws = require("./tbvws");
const tfvws = require("./tfvws");
const smartnames = require("./smartnames");
const variants = require("./variants");
const blacklist = require("./blacklist");
const log = require("./log");
const safeMode = require("./safemode");
const extend = require("./extender");
const menus = require("./menus");
const settings = require("./settings");
const about = require("./about");
const utils = require("./utils");
const masked = require("./masked");

const hotkeys = require("./hotkeys");

const ACTIVE_ICON = {
	18: self.data.url("images/icon-18.apng"),
	36: self.data.url("images/icon-36.png"),		
}
const ACTIVE_ICON_MARKER = {
	18: self.data.url("images/icon-18-mark.apng"),
	36: self.data.url("images/icon-36.png"),		
}
const ACTIVE_ICON_STATIC = {
	18: self.data.url("images/icon-18.png"),
	36: self.data.url("images/icon-36.png"),		
}
const ACTIVE_ICON_STATIC_MARKER = {
	18: self.data.url("images/icon-18-mark.png"),
	36: self.data.url("images/icon-36.png"),		
}
const INACTIVE_ICON = {
	18: self.data.url("images/icon-18-off.png"),
	36: self.data.url("images/icon-36.png"),		
}

const toWidgetId = id =>
	('action-button--' + self.id.toLowerCase()+ '-' + id).
	replace(/[^a-z0-9_-]/g, '');

var vdhActionButton = ActionButton({
	id: "vdh-tbbutton",
	label: _("video-downloadhelper"),
	icon: INACTIVE_ICON,
	badge: "",
	badgeColor: "#00f",
	onClick: function(state) {
		var windowModel = windows.activeWindow;
		if(!windowModel)
			return;
		var window = viewFor(windowModel);
		var vdhActionButtonNode = window.document.getElementById(toWidgetId("vdh-tbbutton"));
		if(vdhActionButtonNode && vdhActionButtonNode.parentNode.id=="PanelUI-contents") {
			ButtonClick({});
		}
	},
});
log.setToolbarIcon(vdhActionButton);

function ButtonClick(event) {
	if(event.shiftKey)
		hits.defaultAction();
	else
		ToggleMainPanel();
}

function InstallButtonHandler(window) {
	var vdhActionButtonNode = window.document.getElementById(toWidgetId("vdh-tbbutton"));
	if(vdhActionButtonNode) {
		var monitored = vdhActionButtonNode.getAttribute("vdh-monitored");
		if(!monitored) {
			vdhActionButtonNode.addEventListener("command",ButtonClick);
			vdhActionButtonNode.setAttribute("vdh-monitored","1");
			return true;
		}
	}
	return false;
}

function UninstallButtonHandler(window) {
	var vdhActionButtonNode = window.document.getElementById(toWidgetId("vdh-tbbutton"));
	if(vdhActionButtonNode) {
		var monitored = vdhActionButtonNode.getAttribute("vdh-monitored");
		if(monitored) {
			vdhActionButtonNode.removeEventListener("command",ButtonClick);
			vdhActionButtonNode.removeAttribute("vdh-monitored");
		}
	}
}

function CustomizationHandler(event) {
	menus.handleCustomization(event);
	if(event.type=="customizationchange") {
		utils.forEachBrowserWindow(function(window) {
			UninstallButtonHandler(window);
			InstallButtonHandler(window);
		});
		menus.stopCompanion();
		menus.startCompanion();		
	} else
		utils.forEachBrowserWindow(function(window) {
			UpdateMainButtonVisibility(window,event.type=="beforecustomization"?true:undefined);
		});
}

function UpdateMainButtonVisibility(window,forced) {
	var vdhActionButtonNode = window.document.getElementById(toWidgetId("vdh-tbbutton"));
	if(vdhActionButtonNode)
		if(typeof forced=="boolean")
			vdhActionButtonNode.setAttribute("collapsed",""+!forced);
		else {
			var tb = simplePrefs.prefs['toolbar-button']; 
			if(tb=="maincomp" || tb=="main")
				vdhActionButtonNode.setAttribute("collapsed","false");
			else
				vdhActionButtonNode.setAttribute("collapsed","true");
		}
}

simplePrefs.on("toolbar-button",function() {
	utils.forEachBrowserWindow(function(window) {
		UpdateMainButtonVisibility(window);
	});	
});

if(simplePrefs.prefs['toolbar-button']=="unset") {
	if(simplePrefs.prefs['companion-enabled'])
		simplePrefs.prefs['toolbar-button'] = "maincomp";
	else
		simplePrefs.prefs['toolbar-button'] = "main";
}

simplePrefs.prefs['tpsr.state'] = "stopped";
simplePrefs.prefs['scrap.state'] = "stopped";

utils.browserWindowsTrack(function(window) {
	InstallButtonHandler(window);
	window.addEventListener("aftercustomization",CustomizationHandler);
	window.addEventListener("beforecustomization",CustomizationHandler);
	window.addEventListener("customizationchange",CustomizationHandler);
	UpdateMainButtonVisibility(window);
},function(window) {
	window.removeEventListener("aftercustomization",CustomizationHandler);
	window.removeEventListener("beforecustomization",CustomizationHandler);
	window.removeEventListener("customizationchange",CustomizationHandler);
});

menus.startCompanion();

function ToggleMainPanel() {
	vdhPanels.togglePanel('main',{
		showOpts: function() {
			return {
				position: vdhActionButton,
			}			  
		},
		estimatedHeight: 91,
		contentURL: "mainPanel.html",
		jsFiles: "mainPanel.js",
		onShow: function(panel) {
			panel.port.emit("contentMessage",{
				type: "set",
				name: "actions",
				value: actions.describeActions(),
			});
		},
		onHide: function() {
			require("./gallery").unselect();
		},
		onMessage: function(message,panel) {
			switch(message.type) {
			case "settings":
				panel.hide();
				settings.toggle();
				break;
			case "about":
				about.toggle();
				break;
			case "action":
				if(!message.shift)
					panel.hide();
				hits.action(message.action,message.hitId);
				break;
			case "more-actions":
				var hitData = hits.getHitData(message.hit.id);
				ToggleActionsPanel(hitData);
				break;
			case "clear":
				hits.clear(message.what);
				break;
			case "clear-log":
				log.reset();
				break;
			case "log-details":
				log.showDetails(message.log);
				break;
			case "convert":
				panel.hide();
				require("./converter").convertLocal();
				break;
			case "sites":
				panel.hide();
				require("./sites").show();
				break;
			case "gallery":
				require("./gallery").checkCurrentPage();
				break;
			case "gallery-select":
				require("./gallery").select(message);
				break;
			case "tpsr":
				panel.hide();
				require("./tpsr").action(message.action);
				break;
			case "scrap":
				panel.hide();
				require("./scrap").action(message);
				break;
			case "operation":
				panel.hide();
				require("./menus").doOperation(message.operation);
				break;
			case "gototab":
				utils.gotoTab(message.url);
				break;
			}
		},
	});
}

var actionHit;
function ToggleActionsPanel(hit) {
	actionHit = hit;
	vdhPanels.togglePanel('actions',{
		showOpts: function() {
			return {
				position: vdhActionButton,
			}			  
		},
		contentURL: "actionsPanel.html",
		jsFiles: [
		    "lib/jquery.min.js",
		    "lib/bootstrap/bootstrap.min.js",
		    "actionsPanel.js",
		],
		onShow: function(panel) {
			panel.port.emit("contentMessage",{
				type: "set",
				name: "hit",
				value: actionHit,
			});
			panel.port.emit("contentMessage",{
				type: "set",
				name: "actions",
				value: actions.describeActions(),
			});
			panel.port.emit("contentMessage",{
				type: "set",
				name: ["data","asDefault"],
				value: false,
			});
		},
		onHide: function() {
		},
		onMessage: function(message,panel) {
			switch(message.type) {
			case "actionCommand":
				if(message.asDefault) {
					simplePrefs.prefs['default-action-'+(actions.describeActions()[message.action].catPriority || 0)] = message.action;
					hits.refresh();
				}
				panel.hide();
				hits.action(message.action,message.hit.id);
				break;
			}
		},
	});
}

function ReceiveHit(hitData) {
	hits.newData(hitData);
}
networkProbe.addListener(ReceiveHit);
tbvws.addListener(ReceiveHit);
tfvws.addListener(ReceiveHit);

simplePrefs.on("icon-badge",function() {
	hits.refresh();
});

simplePrefs.on("icon-badge-error",function() {
	hits.refresh();
});

if(simplePrefs.prefs['medialink-auto-detect'])
	require("./gallery");

function UpdateHits(hitsData,varPath) {
	var varName;
	if(varPath)
		varName = ['hits'].concat(varPath);
	else 
		varName = ['hits'];
	vdhPanels.panelData('main',varName,hitsData);
	if(!varPath) {
		var activeTabCount = 0;
		var anyTabCount = 0;
		var pinnedCount = 0;
		var runningCount = 0;
		
		for(var id in hitsData)
			switch(hitsData[id].status) {
			case 'running':
				runningCount++;
				break;
			case 'active':
				activeTabCount++;
				anyTabCount++;
				break;
			case 'inactive':
				anyTabCount++;
				break;
			case 'pinned':
				pinnedCount++;
				break;
			}

		if(anyTabCount==0 || (simplePrefs.prefs['icon-activation']=='currenttab' && activeTabCount==0))
			vdhActionButton.icon = INACTIVE_ICON;
		else if(simplePrefs.prefs['icon-animation'])
			vdhActionButton.icon = simplePrefs.prefs['icon-marker']? ACTIVE_ICON_MARKER : ACTIVE_ICON;
		else 
			vdhActionButton.icon = simplePrefs.prefs['icon-marker']? ACTIVE_ICON_STATIC_MARKER : ACTIVE_ICON_STATIC;
		
		vdhActionButton.badge = "";
		vdhActionButton.badgeColor = "#00f";
		switch(prefs.prefs['icon-badge']) {
		case 'tasks':
			vdhActionButton.badge = runningCount || '';
			break;
		case 'activetab':
			vdhActionButton.badge = activeTabCount || '';
			break;
		case 'anytab':
			vdhActionButton.badge = anyTabCount || '';
			break;
		case 'pinned':
			vdhActionButton.badge = pinnedCount || '';
			break;
		case 'mixed':
			if(pinnedCount>0) {
				vdhActionButton.badgeColor = "#000";
				vdhActionButton.badge = pinnedCount;
			} else if(runningCount>0) {
				vdhActionButton.badgeColor = "#00f";
				vdhActionButton.badge = runningCount;
			} else if(activeTabCount>0) {
				vdhActionButton.badgeColor = "#080";
				vdhActionButton.badge = activeTabCount;
			} else if(anyTabCount>0) {
				vdhActionButton.badgeColor = "#b59e32";
				vdhActionButton.badge = anyTabCount;
			}
		}
		
		log.updateBadge();
		
		menus.updateHits(hitsData);
	}
}

hits.addListener(UpdateHits);

const RECHECK_RE = new RegExp("https?://[^/]*\\bdownloadhelper\\.net/(?:license-revalidate-v3|license-purchased|register)\\.php\\b.*");

pageMod.PageMod({
	include: RECHECK_RE,
	contentScriptFile: self.data.url("relay-content.js"),
	contentScriptWhen: 'start',
	onAttach: function(worker) {
		worker.port.on("vdh-message",function(message) {
			if(message.type=='recheck-license') {
				var converter = require("./converter");
				converter.checkLicense(message.key,function() {
					var license = converter.config().license;
					worker.port.emit("vdh-message",{
						licenseStatus: license.status,
						licenseEmail: license.email || null,
					});
				});
			}
		});
	}
});

const DONATE_RE = new RegExp("https?://[^/]*\\bdownloadhelper\\.net/(?:thankyou-stripe)\\.php\\b.*");

pageMod.PageMod({
	include: DONATE_RE,
	contentScriptFile: self.data.url("relay-content.js"),
	contentScriptWhen: 'start',
	onAttach: function(worker) {
		worker.port.on("vdh-message",function(message) {
			if(message.type=='donated')
				require("./funding").donated();
		});
	}
});

var versionChangeChecked = false;
function CheckVersionChange() {
	if(versionChangeChecked)
		return;
	versionChangeChecked = true;
	var lastVersion = simplePrefs.prefs['last-version'];
	if(!lastVersion) 
		try {
			lastVersion = Cc["@mozilla.org/preferences-service;1"]
				.getService(Ci.nsIPrefService)
				.getBranch("dwhelper")
				.getCharPref("last-version");
		} catch($_) {}

	if(lastVersion=="5.6.0" && self.version=="5.6.1")
		return;
		
	if(lastVersion!=self.version) {
		simplePrefs.prefs['last-version'] = self.version;
		if(lastVersion===undefined)
			tabs.open({
				url: "http://www.downloadhelper.net/welcome.php?version="+self.version,
			});
		else 
			tabs.open({
				url: "http://www.downloadhelper.net/update.php?from="+lastVersion+"&to="+self.version,
			});
	}
}
tabs.on("activate",CheckVersionChange);

require("sdk/system/unload").when(function() {
	networkProbe.removeListener(ReceiveHit);
	tbvws.removeListener(ReceiveHit);
	tfvws.removeListener(ReceiveHit);
	hits.removeListener(UpdateHits);
	utils.forEachBrowserWindow(function(window) {
		UninstallButtonHandler(window);		
	});
});

