/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const self = require("sdk/self");
const _ = require("sdk/l10n").get;
const contextMenu = require("sdk/context-menu");
const simplePrefs = require("sdk/simple-prefs");
const timers = require("sdk/timers");

const hits = require("./hits");
const utils = require("./utils");

const toWidgetId = id =>
	('action-button--' + self.id.toLowerCase()+ '-' + id).
	replace(/[^a-z0-9_-]/g, '');

const globalCommands = [{
	name: _('about'),
	icon: self.data.url("images/icon-about-64.png"),
	action: 'about',
},{
	name: _('settings'),
	icon: self.data.url("images/icon-settings-64.png"),
	action: 'settings',			
},{
	name: _('convert-local-files'),
	icon: self.data.url("images/icon-action-convert-b-64.png"),
	action: 'convert',			
},{
	name: _('supported-sites'),
	icon: self.data.url("images/icon-sites-list-64.png"),
	action: 'sites',			
},{
	name: _('analyze-page'),
	icon: self.data.url("images/icon-photo-64.png"),
	action: 'gallery',			
},{
	name: _('clear-hits'),
	icon: self.data.url("images/icon-reset-64.png"),
	action: 'clearhits',			
},{
	name: _('tpsr.start-par-long'),
	icon: self.data.url("images/icon-par-64.png"),
	action: 'start-par',
	context: function() {
		return simplePrefs.prefs['tpsr.enabled'] && simplePrefs.prefs['tpsr.state']=='stopped';
	},
},{
	name: _('tpsr.stop-par-long'),
	icon: self.data.url("images/icon-par-stop-64.png"),
	action: 'stop-par',
	context: function() {
		return simplePrefs.prefs['tpsr.state']=='started';
	},
},{
	name: _('scrap.start-scrap-long'),
	icon: self.data.url("images/icon-action-record-64.png"),
	action: 'start-scrap',
	context: function() {
		return simplePrefs.prefs['scrap.enabled'] && simplePrefs.prefs['scrap.state']=='stopped';
	},
},{
	name: _('scrap.stop-scrap-long'),
	icon: self.data.url("images/icon-action-stoprecord-64.png"),
	action: 'stop-scrap',
	context: function() {
		return simplePrefs.prefs['scrap.state']=='started';
	},
}];
	
var quickMenu = null, allMenu = null, commandMenuItems = null, commandMenu = null, 
	smartnamesMenu = null, vdhMenuItems = null, vdhMenu = null;

function CreateContextMenus() {
	if(vdhMenu)
		return;
	quickMenu = contextMenu.Menu({
		label: _('media'),
		contentScript: 'self.on("click", function (node, data) {' +
		' self.postMessage(data);' +
		'});',
	    onMessage: function(hitId) {
	    	hits.executeDefaultAction(hitId);
	    },
	});
	
	allMenu = contextMenu.Menu({
		label: _('all-actions'),
		contentScript: 'self.on("click", function (node, data) {' +
		' self.postMessage(data);' +
		'});',
	    onMessage: function(data) {
	    	var m = /^(.*?)\/(.*)$/.exec(data);
	    	if(m)
	    		hits.action(m[1],m[2]);
	    },
	});
	
	commandMenuItems = [];
	globalCommands.forEach(function(command) {
		var item = {
			label: command.name,
			contentScript: 'self.on("click", function() {' +
				'  self.postMessage("click");' +
				'});',
			onMessage: function(message) {
				if(message=="click")
					DoOperation(command.action);
			},
			image: command.icon,
		}
		if(command.context)
			item.context = contextMenu.PredicateContext(command.context);
		commandMenuItems.push(contextMenu.Item(item));
	});
	
	commandMenu = contextMenu.Menu({
		label: _('options'),
		items: commandMenuItems,
	});
	
	smartnamesMenu = contextMenu.Item({
		label: _('define-vdh-smartname'),
		contentScript: 'self.on("click", function() {' +
			'  self.postMessage("click");' +
			'});',
		onMessage: function(message) {
			if(message=="click")
				require("./smartnames").defineXPath();
		},
		context: contextMenu.PredicateContext(function(data) {
			return data.selectionText && data.selectionText.length>0;
		}),
	})
	
	vdhMenuItems = [
	    quickMenu,
	    allMenu,
	    smartnamesMenu,
	    commandMenu,
	]; 
	
	vdhMenu = contextMenu.Menu({
		label: _('video-downloadhelper'),
		items: vdhMenuItems,
		context: contextMenu.PredicateContext(function(data) {
			return true;
		}),
	});
}

function DestroyContextMenus() {
	if(!vdhMenu)
		return;
	function Destroy(item) {
		if(item.items)
			item.items.forEach(function(item) {
				Destroy(item);
			});
		item.destroy();
	}
	Destroy(vdhMenu);
	quickMenu = null; allMenu = null; commandMenuItems = null; commandMenu = null; 
	smartnamesMenu = null; vdhMenuItems = null; vdhMenu = null;
}

function UpdateContextMenusExistence() {
	if(simplePrefs.prefs['context-menu'])
		CreateContextMenus();
	else
		DestroyContextMenus();
}
UpdateContextMenusExistence();
simplePrefs.on("context-menu",UpdateContextMenusExistence);

function HitLabel(hit) {
	var descr = [];
	if(hit.size) {
		descr.push(hit.size);
	}
	if(hit.adp)
		descr.push("ADP");
	if(hit.length) {
		if(hit.length>1024*1024)
			descr.push(_('MB',Math.round((hit.length*10)/(1024*1024))/10));
		else if(hit.length>1024)
			descr.push(_('KB',Math.round((hit.length*10)/1024)/10));
		else
			descr.push(_('Bytes',hit.length));
	}
	if(descr.length>0)
		return "["+descr.join("-")+"] "+hit.title;
	else
		return hit.title;
}

var currentHits = [];

function SetCompanionDefault(companion,which) {
	var image = "icon-18.png";
	switch(which || simplePrefs.prefs['companion-default-op']) {
	case "about":
		image = "images/icon-about-18.png";
		break;
	case "settings":
		image = "images/icon-settings-18.png";
		break;
	case "convert":
		image = "images/icon-action-convert-b-18.png";
		break;
	case "sites":
		image = "images/icon-sites-list-18.png";
		break;
	case "gallery":
		image = "images/icon-photo-18.png";
		break;
	case "clearhits":
		image = "images/icon-reset-18.png";
		break;
	case "start-scrap":
		image = "images/icon-action-record-18.png";
		break;
	case "stop-scrap":
		image = "images/icon-action-stoprecord-18.png";
		break;
	}
	companion.setAttribute("image",self.data.url(image));
	companion.setAttribute("vdh-action",which || simplePrefs.prefs['companion-default-op']);
}

exports.updateHits = function(hits) {
	var actions = require("./actions").describeActions();
	currentHits = [];
	for(var id in hits) {
		var hit = hits[id];
		if(hit.status!="active")
			continue;
		currentHits.push(hit);
	}
	currentHits.sort(function(h1,h2) {
		var pa = h1._priorityClass || 0; 
		var pb = h2._priorityClass || 0; 
		if(pa!=pb)
			return pb-pa; 				
		if(h1._priorityCat!==undefined && h1._priorityCat===h2._priorityCat && h1._priority!==h2._priority)
				return (h2._priority||0)-(h1._priority||0);
		if(h1.timestamp==h2.timestamp)
				return (h1.order||0)-(h2.order||0);
		return h1.timestamp-h2.timestamp;
	});
	utils.forEachBrowserWindow(function(window) {
		var document = window.document;
		var companion = document.getElementById("vdh-companion");
		if(companion) {
			if(simplePrefs.prefs['scrap.state']=="started") {
				SetCompanionDefault(companion,"stop-scrap");
				companion.removeAttribute("vdh-hit");				
			} else if(currentHits.length>0 && currentHits[0].actions.length>0) {
				var hit = currentHits[0];
				companion.setAttribute("image",self.data.url(actions[hit.actions[0]].icon18));
				companion.setAttribute("vdh-hit",hit.id);
				companion.setAttribute("vdh-action",hit.actions[0]);
			} else {
				SetCompanionDefault(companion);
				companion.removeAttribute("vdh-hit");
			}
		}
	});
}

function WalkDom(node) {

	var lines = [];

	function _WalkDom(node,level) {
		var strs = [];
		for(var i = 0; i<level; i++)
			strs.push("    ");
		if(node.nodeType == 1) {
			strs.push("<"+node.tagName+" ");
			var attrs=[];
			Array.prototype.slice.call(node.attributes).forEach(function(item) {
				attrs.push(item.name+"=\""+item.value+"\"");
			});
			strs.push(attrs.join(" "));
			if(node.firstChild) {
				strs.push(">");
				lines.push(strs.join(""));				
				var node0 = node.firstChild;
				while(node0) {
					_WalkDom(node0,level+1);
					node0 = node0.nextSibling;
				}
				strs = [];
				for(var i = 0; i<level; i++)
					strs.push("    ");
				strs.push("</"+node.tagName+">");
			}
			else
				strs.push("/>");
			
		} else if(node.nodeType == 3)
			strs.push(node.nodeValue);
		lines.push(strs.join(""));
	}
	_WalkDom(node,0);
	console.info(lines.join("\n"));
}

function DoOperation(action) {
	switch(action) {
	case 'about':
		require("./about").toggle();
		break;
	case 'settings':
		require("./settings").toggle();
		break;
	case 'convert':
		require("./converter").convertLocal();
		break;
	case 'sites':
		require("./sites").show();
		break;
	case 'gallery':
		require("./gallery").checkCurrentPage();
		break;
	case 'clearhits':
		require("./hits").clear("all");
		break;
	case 'start-par':
		require("./tpsr").action("start");
		break;
	case 'stop-par':
		require("./tpsr").action("stop");
		break;
	case 'start-scrap':
		require("./scrap").action({action:"start"});
		break;
	case 'stop-scrap':
		require("./scrap").action({action:"stop"});
		break;
	}	
}

function CompanionClick(event) {
	var hitId = event.target.getAttribute("vdh-hit");
	var action = event.target.getAttribute("vdh-action");
	if(event.target.nodeName=="toolbarbutton") {
		if(action)
			if(hitId)
				hits.action(action,hitId);
			else
				DoOperation(action);
	} else if(event.target.nodeName=="menuitem") {
		if(hitId)
			if(action)
				hits.action(action,hitId);
			else
				hits.executeDefaultAction(hitId);
		else
			DoOperation(action);
	}
}

function MakeHitsMenu(menupopup) {
	var actions = require("./actions").describeActions();
	var document = menupopup.ownerDocument;
	while(menupopup.firstChild && menupopup.firstChild.getAttribute("vdh-temporary"))
		menupopup.removeChild(menupopup.firstChild);
	var anchorNode = menupopup.firstChild;
	currentHits.forEach(function(hit) {
        var menuitem = document.createElement('menuitem');
        menuitem.setAttribute('label', HitLabel(hit));
        menuitem.setAttribute('vdh-hit', hit.id);
        menuitem.setAttribute('vdh-temporary', "1");
        menuitem.setAttribute('class', 'menuitem-iconic');
        menuitem.setAttribute('image', self.data.url(actions[hit.actions[0]].icon));
        menupopup.insertBefore(menuitem,anchorNode);		
	});
	function AddSeparator(menupopup,anchorNode) {
        var menusep = document.createElement('menuseparator');
        menusep.setAttribute('vdh-temporary', "1");
        menupopup.insertBefore(menusep,anchorNode);		
	}
	if(currentHits.length>0) {
		AddSeparator(menupopup,anchorNode)
        var menu = document.createElement("menu");
        menu.setAttribute('label', _('all-actions'));
        menu.setAttribute('vdh-temporary', "1");
        menupopup.insertBefore(menu,anchorNode);
		var menupopup2 = document.createElement('menupopup');
        menu.appendChild(menupopup2);
    	currentHits.forEach(function(hit) {
            var menu = document.createElement("menu");
            menu.setAttribute('label', HitLabel(hit));
            menupopup2.appendChild(menu);
    		var menupopup3 = document.createElement('menupopup');
            menu.appendChild(menupopup3);
			hit.actions.forEach(function(action) {
		        var menuitem = document.createElement('menuitem');
		        menuitem.setAttribute('label', actions[action].title);
		        menuitem.setAttribute('vdh-hit', hit.id);
		        menuitem.setAttribute('vdh-action', action);
		        menuitem.setAttribute('class', 'menuitem-iconic');
		        menuitem.setAttribute('image', self.data.url(actions[action].icon));
		        menupopup3.appendChild(menuitem);
			});                		
    	});
		AddSeparator(menupopup,anchorNode)        
	}
}

function CompanionPopupShowing(event) {
	if(event.target.getAttribute("id")!="vdh-menupopup")
		return;
	var window = event.target.ownerDocument.defaultView;
	var document = window.document;
	var companion = document.getElementById("vdh-companion");
	if(!companion)
		return;
	var menupopup = companion.firstChild;
	MakeHitsMenu(menupopup);
	menupopup.appendChild(MakeOptionsMenu(document));
}

function UninstallCompanion(window) {
	var companion = window.document.getElementById("vdh-companion"); 
	if(!companion)
		return;
	companion.removeEventListener("command",CompanionClick);
	companion.removeEventListener("popupshowing",CompanionPopupShowing);
	companion.parentNode.removeChild(companion);
}

function MakeOptionsMenu(document) {
    var menu = document.createElement('menu');
    menu.setAttribute('label', _('options'));
    menu.setAttribute("vdh-temporary","1");
	var menupopup2 = document.createElement('menupopup');
	
	globalCommands.forEach(function(option) {
		// TODO make that dynamic
		if(option.context && !option.context())
			return;
		var menuitem = document.createElement('menuitem');
        menuitem.setAttribute('label', option.name);
        menuitem.setAttribute('vdh-action', option.action);
        menuitem.setAttribute('class', 'menuitem-iconic');
        menuitem.setAttribute('image', option.icon);
        menupopup2.appendChild(menuitem);
	});
	
    menu.appendChild(menupopup2);
    return menu;
}

function InstallCompanion(window) {
	var tbMode = simplePrefs.prefs['toolbar-button']
	if(tbMode=="main")
		return;
	if(window.document.getElementById("vdh-companion"))
		return;
	var vdhActionButtonNode = window.document.getElementById(toWidgetId("vdh-tbbutton"));
	if(vdhActionButtonNode) {
		if(vdhActionButtonNode.parentNode.id=="PanelUI-contents")
			return;
		var document = window.document;
		var companion = document.createElement('toolbarbutton');
		companion.setAttribute("id","vdh-companion");
		companion.setAttribute("type","menu-button");
		companion.setAttribute('class', 'toolbarbutton-1');
		SetCompanionDefault(companion);
		companion.addEventListener("command",CompanionClick);
		companion.addEventListener("popupshowing",CompanionPopupShowing);
		
		var menupopup = document.createElement('menupopup');
        menupopup.setAttribute('id', 'vdh-menupopup');

        companion.appendChild(menupopup)
        
        vdhActionButtonNode.parentNode.insertBefore(companion,vdhActionButtonNode.nextSibling);
        
		//WalkDom(vdhActionButtonNode);
	}
}

exports.handleCustomization = function(event) {
	if(event.type=="beforecustomization")
		utils.forEachBrowserWindow(function(window) {
			UninstallCompanion(window);
		});
	else if(event.type=="aftercustomization")
		utils.forEachBrowserWindow(function(window) {
			InstallCompanion(window);
		});
}

exports.startCompanion = function() {
	utils.browserWindowsTrack(InstallCompanion,UninstallCompanion);
}

exports.stopCompanion = function() {
	utils.browserWindowsTrackEnd(InstallCompanion,UninstallCompanion);
}

exports.appendMenuItem = function(data) {
	if(!vdhMenu)
		return;
	vdhMenuItems.push(contextMenu.Item(data));
	vdhMenu.items = vdhMenuItems;
}

exports.doOperation = function(action) {
	DoOperation(action);
}

require("sdk/system/unload").when(function() {
	exports.stopCompanion();
});

simplePrefs.on("toolbar-button",function() {
	utils.forEachBrowserWindow(function(window) {
		UninstallCompanion(window);
		InstallCompanion(window);
	});
});

function PopupShowing(event) {
	if(!vdhMenu)
		return;
	if(event.target.getAttribute("id")!="contentAreaContextMenu")
		return;
	var vdh = _('video-downloadhelper');
	var node = event.target.firstChild;
	while(node) {
		if(node.nodeType==1 && node.getAttribute("label")==vdh)
			break;
		node = node.nextSibling;
	}
	if(node) {
		if(!node.getAttribute("vdh-watching")) {
			node.setAttribute("vdh-watching","1");
			node.addEventListener("command",ContextClick,false);
		}
		MakeHitsMenu(node.firstChild);
	}
}

function ContextClick(event) {
	var hitId = event.target.getAttribute("vdh-hit");
	var action = event.target.getAttribute("vdh-action");
	if(hitId)
		if(action)
			hits.action(action,hitId);
		else
			hits.executeDefaultAction(hitId);
}

function ToolsClick(event) {
	var hitId = event.target.getAttribute("vdh-hit");
	var action = event.target.getAttribute("vdh-action");
	if(hitId) {
		if(action)
			hits.action(action,hitId);
		else
			hits.executeDefaultAction(hitId);
	} else if(action) 
		DoOperation(action);	
}

function ToolsPopupShowing(event) {
	if(event.target && event.target.getAttribute("id")=="menu_ToolsPopup") {
		var document = event.target.ownerDocument;
		var vdhMenu = document.getElementById("vdh-tools-menu");
		if(vdhMenu) {
			var vdhPopup = vdhMenu.firstChild;
			while(vdhPopup.firstChild)
				vdhPopup.removeChild(vdhPopup.firstChild);
			MakeHitsMenu(vdhPopup);
	        vdhPopup.appendChild(MakeOptionsMenu(document));
		}
	}
}

function UpdateToolsMenu(window,on) {
	var document = window.document;
	var popup = document.getElementById("menu_ToolsPopup"), vdhPopup;
	var node = window.document.getElementById("vdh-tools-menu");
	if(node && !on) {
		node.parentNode.removeChild(node);
		popup.removeEventListener("popupshowing",ToolsPopupShowing);
		popup.removeEventListener("command",ToolsClick);
	} else if(!node && on) {
        vdhPopup = document.createElement('menupopup');
        var menu = window.document.createElement('menu');
        menu.setAttribute("id","vdh-tools-menu");
        menu.setAttribute('label',_('video-downloadhelper'));
        menu.appendChild(vdhPopup);
        popup.appendChild(menu);
        popup.addEventListener("popupshowing",ToolsPopupShowing);
		popup.addEventListener("command",ToolsClick);
	}
}

utils.browserWindowsTrack(function WatchContent(window) {
	window.addEventListener("popupshowing",PopupShowing,false);
	UpdateToolsMenu(window,simplePrefs.prefs['show-in-toolsmenu']);
},function UnwatchContent(window) {
	window.removeEventListener("popupshowing",PopupShowing,false);	
	UpdateToolsMenu(window,false);
});

simplePrefs.on("show-in-toolsmenu",function() {
	utils.forEachBrowserWindow(function(window) {
		UpdateToolsMenu(window,simplePrefs.prefs['show-in-toolsmenu']);
	});
});

