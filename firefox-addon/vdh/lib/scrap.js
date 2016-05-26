/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */

const $chrome = require("chrome");
const Cc = $chrome.Cc;
const Ci = $chrome.Ci;
const Cu = $chrome.Cu;
const windows = require("sdk/windows").browserWindows;
const viewFor = require("sdk/view/core").viewFor;
const Class = require('sdk/core/heritage').Class;
const timers = require("sdk/timers");
const simplePrefs = require('sdk/simple-prefs');
const privateBrowsing = require("sdk/private-browsing");
const _ = require("sdk/l10n").get;
const self = require("sdk/self");

const actions = require("./actions");
const hits = require("./hits");
const panels = require("./panels");
const smartNames = require("./smartnames");
const converter = require("./converter");

var actionHit = null, process = null;

function GetOffset(element) {
    var top = 0, left = 0;
    do {
        top += element.offsetTop  || 0;
        left += element.offsetLeft || 0;
        element = element.offsetParent;
    } while(element);

    return {
        top: top,
        left: left
    };
};

function StartCapture(cOptions) {
	
	cOptions.window = cOptions.window || viewFor(windows.activeWindow);
	
	if(!cOptions.filePath && !cOptions.snapshot) {
		var file = actions.getDownloadDirectory(privateBrowsing.isPrivate(windows.activeWindow));
		file.append("screen-capture.mp4");
		file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0644);
		file.remove(false);
		cOptions.filePath = file.path;
	}
	
	cOptions.browser = cOptions.browser || cOptions.window.gBrowser.selectedBrowser; 
	
	var browserMM = cOptions.browser.messageManager;
	
	if(!cOptions.browser.getAttribute("vdh-scrap")) {
		browserMM.loadFrameScript(self.data.url("scrap-script.js"),false);
		cOptions.browser.setAttribute("vdh-scrap","true");
	}
	
	if(cOptions.snapshot) {
		function SnapshotListener(message) {
			if(message.data.data) {
				var isPrivate = privateBrowsing.isPrivate(windows.activeWindow);
				var file = actions.getDownloadDirectory(isPrivate);
				file.append("screenshot.png");
				file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0644);
				file.remove(false);
				require("./downloads").download({
					source: {
						url: message.data.data,
						isPrivate: isPrivate,
					},
					target: {
						path: file.path, 
					},
					
				});
			}
			browserMM.removeMessageListener("vdh",SnapshotListener);
		}
		browserMM.addMessageListener("vdh",SnapshotListener);
		browserMM.sendAsyncMessage("vdh", {
			type: "snapshot",
			selector: cOptions.selector,
		});
		return;
	}
	
	simplePrefs.prefs['scrap.state']='started';
	require("./menus").updateHits([]);
	hits.refresh();

	var frameCount = 0, stats = {}, frameOutputStream = null, chromeStats = {
		successfulWrites: 0,
		missedWrites: 0,
	};
	
	function MessageListener(message) {
		var data = message.data;
		switch(data.type) {
		case "geometry":
			StartConverter(data);
			timers.setTimeout(function() {
				ConnectConverter(data);
			},0);
			break;
		case "error": 
			require("./log").error({
				text: _("scrap.error"),
				details: data.error,
			});
			EndCapture();
			break;
		case "frame":
			frameCount++;
			if(frameOutputStream) {
				frameOutputStream.write(data.data);
				stats = data.stats;
			}
			break;
		case "stats":
			stats = data.stats;
			EndCapture();
			break;
		}		
	}

	function EndCapture() {
		simplePrefs.off("scrap.state");
		simplePrefs.prefs['scrap.state'] = "stopped";
		require("./menus").updateHits([]);
		hits.refresh();
		browserMM.removeMessageListener("vdh",MessageListener);
		if(frameOutputStream)
			frameOutputStream.close();
		if(actionHit) {
			actionHit.data.scraping = false;
			actionHit.data._trackMouse = true;
			actionHit.data._priorityClass = -1; 
			actionHit.updateActions();
			actionHit = null;
		} else 
			hits.refresh();
		if(process && simplePrefs.prefs['scrap.explicit-kill'])
			try {
				process.kill("SIGQUIT");
			} catch($_) {}
		process = null;
	}

	browserMM.addMessageListener("vdh",MessageListener);
	
	browserMM.sendAsyncMessage("vdh", {
		type: "get-geometry",
		align: simplePrefs.prefs['scrap.8x8-align'],
		selector: cOptions.selector,
	});					

	simplePrefs.on("scrap.state",function() {
		switch(simplePrefs.prefs['scrap.state']) {
		case "stopping":
			browserMM.sendAsyncMessage("vdh", {
				type: "stop",
			});
			Poll();
		}
	});
	
	function Keypressed(event) {
		browserMM.sendAsyncMessage("vdh", {
			type: "meta-key",
			metaKey: !!event.shiftKey,
		});					
	}
	cOptions.window.addEventListener("keydown",Keypressed);
	cOptions.window.addEventListener("keyup",Keypressed);

	
	var socketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService);
	var threadManager = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);

	
	var BufferedArrayOutputStream = new Class({
		initialize: function(outputStream) {
			this.outputStream = outputStream;
		},
		write: function(data) {
			try {
				this.outputStream.writeByteArray(data,data.length);
				chromeStats.successfulWrites++;
			} catch(e) {
				chromeStats.missedWrites++;				
			}
		},
		close: function() {
			this.outputStream.close();
		},
		flush: function() {
			this.outputStream.flush();
		},
	});
	
	function EndPanel(options) {
		panels.togglePanel('scrapend',{
			contentURL: "scrapEndPanel.html",
			top: 10,
			closeTimeout: 0,
			jsFiles: [
			    "scrapEndPanel.js",
			],
			onShow: function(panel) {
				var converter = require("./converter")
				converter.check(function() {
					panel.port.emit("contentMessage",{
						type: "set",
						name: "converter",
						value: converter.config(),
					});					
				});
				if(options.filePath)
					panel.port.emit("contentMessage",{
						type: "set",
						name: "options",
						value: options,
					});					
			},
			onMessage: function(message,panel) {
				panel.hide();
				Cu.import("resource://gre/modules/FileUtils.jsm");
				switch(message.type) {
				case "launch":
					var file = new FileUtils.File(options.filePath);
					file.launch();
					break;
				case "container":
					var file = new FileUtils.File(options.filePath);
					file.parent.launch();
					break;
				case "convert":
					var file = new FileUtils.File(options.filePath);
					var converter = require("./converter"); 
					var config = converter.config().configs[simplePrefs.prefs['scrap.convert']];
					if(config)
						converter.batchConvert([file.path],config);
					break;
				}
			},
		});			
	}

	function StartConverter(options) {
		process = converter.convertInput({
			width: options.width,
			height: options.height,
			outputFilePath: cOptions.filePath,
			rate: simplePrefs.prefs['scrap.rate'],
			port: simplePrefs.prefs['scrap.port'],
		},function(code,stdout,stderr) {
			cOptions.window.removeEventListener("keydown",Keypressed);
			cOptions.window.removeEventListener("keyup",Keypressed);
			if(!code) {
				EndPanel({
					filePath: cOptions.filePath,
					originalSize: options.orgWidth+"x"+options.orgHeight,
					capturedSize: options.width+"x"+options.height,
					capturedFrames: {
						captured: ""+stats.captured,
						skipped: ""+stats.skipped,
						missed: ""+Math.max(0,stats.optimalFrameCount-stats.captured),
					},
					savedFrames: {
						saved: ""+chromeStats.successfulWrites,
						failed: ""+chromeStats.missedWrites,
					},
					duration: stats.duration/1000,
				});
			} else {
				console.warn("Failed running converter",code,stderr);
				require("./log").error({
					text: "Failed converter exec",
					details: stderr,
				});
				EndCapture();
			}
		});
	}
	
	function Poll() {
		try {
			browserMM.sendAsyncMessage("vdh", {
				type: "poll",
			});
		} catch(e) {
			EndCapture();
			return;
		}
		if(simplePrefs.prefs['scrap.state']=="started")
			cOptions.window.requestAnimationFrame(Poll);
	}

	function ConnectConverter(options) {
		var eventSink = {
			onTransportStatus: function(aTransport,aStatus,aProgress,aProgressMax) {
				switch(aStatus) {
				case 2152398852:
					timers.clearTimeout(timer);
					browserMM.sendAsyncMessage("vdh", {
						type: "start",
						rate: simplePrefs.prefs['scrap.rate'],
						align: simplePrefs.prefs['scrap.8x8-align'],
						mouse: cOptions.mouse || simplePrefs.prefs['scrap.mouse'],
						haloRadius: simplePrefs.prefs['scrap.mouse.halo.radius'],
						haloColor: simplePrefs.prefs['scrap.mouse.halo.color'],
						haloTransparency: simplePrefs.prefs['scrap.mouse.halo.transparency'],
						pointerSize: simplePrefs.prefs['scrap.mouse.pointer.size'],
						stopOnPageUnload: !!cOptions.stopOnPageUnload,
					});
					Poll();
					break;
				case 2152398853:
					break;
				case 2152398851:
				case 2152398859:
				case 2152398855:
					break;
				default: 
					console.info("event",aStatus,"0x"+aStatus.toString(16));
				}
			}
		}
		var transport = socketTransportService.createTransport(null,0,"localhost",simplePrefs.prefs['scrap.port'],null);
		transport.setEventSink(eventSink, threadManager.currentThread);		
		var outputStream = transport.openOutputStream(0,options.frameSize,10);
		var binaryOutputStream = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
		binaryOutputStream.setOutputStream(outputStream);
		frameOutputStream = new BufferedArrayOutputStream(binaryOutputStream);
		var timer = timers.setTimeout(function() {
			frameOutputStream.close();
			frameOutputStream = null;
			ConnectConverter(options);
		},100);
	}
}

function StartPanel(callback,options) {

	panels.togglePanel('scrap',{
		contentURL: "scrapPanel.html",
		top: 10,
		closeTimeout: 0,
		jsFiles: [
		    "scrapPanel.js",
		],
		onShow: function(panel) {
			var converter = require("./converter")
			converter.check(function() {
				panel.port.emit("contentMessage",{
					type: "set",
					name: "converter",
					value: converter.config(),
				});					
			});
			if(options.filePath)
				panel.port.emit("contentMessage",{
					type: "set",
					name: "filePath",
					value: options.filePath,
				});					
			panel.port.emit("contentMessage",{
				type: "set",
				name: "pageMode",
				value: options.pageMode,
			});					
		},
		onMessage: function(message,panel) {
			switch(message.type) {
			case "start":
				panel.hide();
				callback(options);
				break;
			case "save-as":
				panel.hide();
				Cu.import("resource://gre/modules/FileUtils.jsm");
				var file = new FileUtils.File(options.filePath);
				var windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
				var window = windowMediator.getMostRecentWindow("navigator:browser");
				var activeWindow = require("sdk/windows").browserWindows.activeWindow;
				var saveFilePicker=Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
				saveFilePicker.init(window, _("title.save-file"), Ci.nsIFilePicker.modeSave);
				saveFilePicker.displayDirectory=file.parent;
				saveFilePicker.defaultString=file.leafName;
				saveFilePicker.appendFilters(Ci.nsIFilePicker.filterAll);
				var rs=saveFilePicker.open(function(rs) {
				    activeWindow.activate();		
					if(rs==Ci.nsIFilePicker.returnOK) {
						options.filePath =  saveFilePicker.file.path;
						StartPanel(callback,options);
					}
				});
				break;
			case "goto":
				panel.hide();
				switch(message.where) {
				case 'converter':
					require("sdk/tabs").open({
						url: "http://www.downloadhelper.net/install-converter3.php",
					});
					break;
				}
				break;
			}
		},
	});	
}

function ConverterRequired() {
	require("./alerts").alert({
		title: _('scrap.error'),
		text: [
		    _('scrap.converter-required'),
		],
		action: [{
			text: _('install-converter'),
			click: "post('installConverter')",
		}],
		onMessage: function(message,panel) {
			switch(message.type) {
			case "installConverter":
				panel.hide();
				require("sdk/tabs").open({
					url: "http://www.downloadhelper.net/install-converter3.php",
				});
				break;
			}
		},
	});	
}

function Start(skipPanel) {
	var file = actions.getDownloadDirectory(privateBrowsing.isPrivate(windows.activeWindow));
	file.append("screen-capture.mp4");
	file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0644);
	file.remove(false);
	
	if(skipPanel)
		converter.check(function() {
			if(converter.config().status=='ready')
				StartCapture({
					filePath: file.path,
				});
			else
				ConverterRequired();
		});
	else
		StartPanel(function(options) {
			StartCapture({
				filePath: options.filePath,
			});		
		},{
			pageMode: true,
			filePath: file.path,
		});
}

exports.action = function(data) {
	switch(data.action) {
	case "start":
		Start();
		break;
	case "stop":
		simplePrefs.prefs['scrap.state']='stopping';
		break;
	case "toggle":
		if(simplePrefs.prefs['scrap.state']=='stopped')
			Start(true);
		else if(simplePrefs.prefs['scrap.state']=='started')
			simplePrefs.prefs['scrap.state']='stopping';
		break;
	}
}

exports.startRecording = function(action) {
	var tabs = require('sdk/tabs');
	for(var ti in tabs) {
		var tab = tabs[ti];
		if(tab.url==action.hit.data.topUrl) {
			var tabView = viewFor(tab);
			if(tabView.linkedBrowser) {

				var window = viewFor(tab.window);
				
				smartNames.getTitle(tab.url,window,function(title) {
					title = smartNames.fixFileName(title+".mp4");
					var file = actions.getDownloadDirectory(privateBrowsing.isPrivate(windows.activeWindow));
					file.append(title);
					file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0644);
					file.remove(false);
					action.hit.data.extension = "mp4";
					
					function Start(options) {
						StartCapture({
							window: window,
							browser: tabView.linkedBrowser,
							selector: action.hit.data.selector,
							mouse: "never",
							stopOnPageUnload: true,
							filePath: options.filePath,
						});
						action.hit.data.scraping = true;
						action.hit.data._trackMouse = false;
						action.hit.data._priorityClass = 1; 
						action.hit.updateActions();
						actionHit = action.hit;
					}
					if(simplePrefs.prefs["scrap.applet-start-not-see-again"])
						converter.check(function() {
							if(converter.config().status=='ready')
								Start({
									filePath: file.path,
								});
							else
								ConverterRequired();
						});
					else
						StartPanel(function(options) {
							Start(options);
						},{
							pageMode: false,
							notSeeAgain: true,
							filePath: file.path,
						});
				});
				return;
			}
		}
	}
}

exports.stopRecording = function(action) {
	if(simplePrefs.prefs['scrap.state']=='started')
		simplePrefs.prefs['scrap.state']='stopping';
}

exports.takeSnapshot = function(action) {
	var tabs = require('sdk/tabs');
	for(var ti in tabs) {
		var tab = tabs[ti];
		if(tab.url==action.hit.data.topUrl) {
			var tabView = viewFor(tab);
			if(tabView.linkedBrowser) {
				var window = viewFor(tab.window);
				StartCapture({
					window: window,
					browser: tabView.linkedBrowser,
					selector: action.hit.data.selector,
					snapshot: true,
				});
				return;
			}
		}
	}
}
