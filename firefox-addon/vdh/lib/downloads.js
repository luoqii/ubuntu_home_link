/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const { Cc, Ci, Cu } = require("chrome");
const timers = require("sdk/timers");
const _ = require("sdk/l10n").get;
const simplePrefs = require('sdk/simple-prefs');
const events = require("sdk/system/events");
const nsIDM = Ci.nsIDownloadManager;

const PROGRESS_TIMEOUT = 100;

var globalId = 0;
var queue = [];
var running = {};
var preparing = {};
var progressTimer = null;

function Failed(specs,reason) {
	EnsuresProgressTimer();
	specs.failure(reason);
	TryDownload();	
}

var headersHook = {};
var headersHooked = false;

const downloadStateNames = {
	"-1": "NOTSTARTED",
	0: "DOWNLOADING",
	1: "FINISHED",
	2: "FAILED",
	3: "CANCELED",
	4: "PAUSED",
	5: "QUEUED",
	6: "BLOCKED_PARENTAL",
	7: "SCANNING",
	8: "DIRTY",
	9: "BLOCKED_POLICY",
}
var monitoredDownloads = {};
var downloadView = {
	onDownloadAdded: function(download) {
		//console.info("onDownloadAdded",download.source.url);
	},
	onDownloadChanged: function(download) {	
		var downloadState = DownloadsCommon.stateOfDownload(download);
		var specs = monitoredDownloads[download.source.url];
		if(specs) {
			specs.download = download;
			var oldState = specs.state;
			if(oldState!=downloadState) {
				//console.info("onDownloadChanged",oldState,"=>",downloadStateNames[downloadState]||"???",download.source.url);
				specs.state = downloadState;
				if(downloadState == nsIDM.DOWNLOAD_FINISHED) {
					delete running[specs.id];
					EnsuresProgressTimer();
					TryDownload();
					RemoveHeadersHook(specs);
					specs.success();
				} else if(downloadState == nsIDM.DOWNLOAD_FAILED) {
					specs.lastRetryPosition = specs.lastRetryPosition || 0;
					if(download.currentBytes!=specs.lastRetryPosition)
						specs.retries = 0;
					specs.lastRetryPosition = download.currentBytes; 
					specs.retries = (specs.retries || 0) + 1;
					if(specs.retries<=simplePrefs.prefs['download.retries']) {
						//console.warn("Download retry",specs.retries,specs.data.target.path);
						download.start();
						return;
					}
					RemoveHeadersHook(specs);
					if(download.error.result==2152398924 && specs.data.target && specs.data.target.partFilePath) { // special partial download case (Firefox 39 issue)
						try {
							Cu.import("resource://gre/modules/FileUtils.jsm");
							var partFile = new FileUtils.File(specs.data.target.partFilePath);
							if(partFile.exists() && partFile.fileSize>0) {
								partFile.permissions |= 0444;
								var file = new FileUtils.File(specs.data.target.path);
								partFile.renameTo(file.parent,file.leafName);
								delete running[specs.id];
								EnsuresProgressTimer();
								TryDownload();
								specs.success();							
								return;
							} 
						} catch(e) {
							console.error("Error handling partial download",e)
						}
					}
					Failed(specs,download.error);					
				} else if(downloadState == nsIDM.DOWNLOAD_PAUSED && specs.data.target.partFilePath) {
					EnsuresProgressTimer();
					TryDownload();
					return;							
				} else if(oldState == nsIDM.DOWNLOAD_PAUSED && downloadState == nsIDM.DOWNLOAD_DOWNLOADING) {
					specs.download = download;
					EnsuresProgressTimer();									
				} else if(downloadState == nsIDM.DOWNLOAD_CANCELED) {
					delete running[specs.id];
					EnsuresProgressTimer();
					TryDownload();
					RemoveHeadersHook(specs);
					specs.failure({
						result: 2147500037,
						message: _('download-canceled'),
					});				
				} else if(oldState == -1 && downloadState == nsIDM.DOWNLOAD_DOWNLOADING) {
					specs.lastProgress = 0;
					specs.progress(0);
				}
			}
		}
	},
	onDownloadRemoved: function(download) {
		//console.info("onDownloadRemoved",download.source.url);
	},
}

Cu.import("resource://gre/modules/Downloads.jsm");
Cu.import("resource:///modules/DownloadsCommon.jsm");
Downloads.getList(Downloads.ALL).then(function(list) {
	list.addView(downloadView);
	require("sdk/system/unload").when(function() {		
		list.removeView(downloadView);
	});
});
		
function ModifyRequest(event) {
	var channel = event.subject.QueryInterface(Ci.nsIHttpChannel);
	var headers = headersHook[channel.name];
	if(headers) {
		for(var header in headers) 
			channel.setRequestHeader(header, headers[header], false);
		var headersVisitor = {
			visitHeader: function(header,value) {
				if(!headers[header])
					channel.setRequestHeader(header,"",false);
			}
		}
		channel.visitRequestHeaders(headersVisitor);
	}
}

function AddHeadersHook(specs) {
	if(!specs.headers || !simplePrefs.prefs['downloads-hook-headers'])
		return;
	headersHook[specs.data.source.url] = specs.headers;
	if(!headersHooked) {
		events.on("http-on-modify-request", ModifyRequest);
		headersHooked = true;
	}
}

function RemoveHeadersHook(specs) {
	if(!specs.headers)
		return;
	delete headersHook[specs.data.source.url];
	if(headersHooked) {
		var empty = true;
		for(var url in headersHook) {
			empty = false;
			break;
		}
		if(empty) {
			events.off("http-on-modify-request", ModifyRequest);
			headersHooked = false;			
		}
	}
}

function ClearHeadersHooks() {
	headersHook = {};
	if(headersHooked) {
		events.on("http-on-modify-request", ModifyRequest);
		headersHooked = false;					
	}
}

simplePrefs.on("downloads-hook-headers",function() {
	var dhh = simplePrefs.prefs['downloads-hook-headers'];
	if(!dhh)
		ClearHeadersHooks();
});

require("sdk/system/unload").when(function() {
	
	ClearHeadersHooks();
});

function GetRunningCount() {
	var count = 0;
	for(var id in running) {
		var specs = running[id];
		if(!specs.download)
			return;
		var downloadState = DownloadsCommon.stateOfDownload(specs.download);
		if(downloadState == nsIDM.DOWNLOAD_DOWNLOADING || downloadState == nsIDM.DOWNLOAD_NOTSTARTED)
			count++;
	}
	return count;
}

function DoTryDownload() {
	var maxDownloads = simplePrefs.prefs['download.controlled.max'];
	var runningCount = GetRunningCount();
	while(queue.length>0 && (maxDownloads==0 || runningCount<maxDownloads)) {
		(function() {
			var specs = queue.shift();
			runningCount++;
			specs.lastProgress = -1;
			preparing[specs.id] = 1;
			AddHeadersHook(specs);
			
			Downloads.createDownload(specs.data).then(function(download) {
				if(specs.data.target.partFilePath)
					download.tryToKeepPartialData = true;
				Downloads.getList(specs.data.source.isPrivate?Downloads.PRIVATE:Downloads.PUBLIC).then(function(list) {
					if(!preparing[specs.id]) {
						Failed(specs,_("aborted"));
						return;
					}
					delete preparing[specs.id];
					list.add(download);
					specs.download = download;
					running[specs.id] = specs;
					
					specs.state = nsIDM.DOWNLOAD_NOTSTARTED;
					EnsuresProgressTimer();

					monitoredDownloads[download.source.url] = specs;
					download.start();
				},function(error) {
					RemoveHeadersHook(specs);
					Failed(specs,error);				
				});
			},function(reason) {
				delete preparing[specs.id];
				RemoveHeadersHook(specs);
				Failed(specs,reason);
			});			
		})();
	}
}

simplePrefs.on("download.controlled.max",DoTryDownload);

function TryDownload() {
	timers.setTimeout(DoTryDownload,0);
}

function EnsuresProgressTimer() {
	//console.info("EnsuresProgressTimer")
	var runningCount = GetRunningCount();
	if(progressTimer && runningCount == 0) {
		timers.clearInterval(progressTimer);
		progressTimer = null;
		//console.info("Stopped progress timer");
	} else if(!progressTimer && runningCount>0) {
		progressTimer = timers.setInterval(UpdateProgress,PROGRESS_TIMEOUT);
		//console.info("Started progress timer");
	}
}

function UpdateProgress() {
	for(var id in running) {
		var spec = running[id];
		//console.info("UpdateProgress",spec);
		if(!spec.download.stopped && spec.download.hasProgress) {
			var progress = spec.download.progress;
			if(progress!=spec.lastProgress) {
				spec.lastProgress = progress;
				spec.progress(progress);
			}
		}
	}
}

function DoNothing() {};

exports.download = function(data,success,failure,progress,headers) {
	var id = ++globalId;
	queue.push({
		id: id,
		data: data,
		success: success || DoNothing,
		failure: failure || DoNothing,
		progress: progress || DoNothing,
		headers: headers,
	});
	TryDownload();
	return id;
}

exports.abort = function(id) {
	queue.forEach(function(entry,index) {
		if(entry.id == id) {
			entry.failure({
				message: _('download-canceled'),
				result:2147500037,
			});
			queue.splice(index,1);
		}
	});
	if(preparing[id])
		delete preparing[id];
	if(running[id]) {
		running[id].download.finalize(true);
	}
}
