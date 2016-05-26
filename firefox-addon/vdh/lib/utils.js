/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


const { Cc, Ci, Cu, CC } = require("chrome");

const BinaryInputStream = CC('@mozilla.org/binaryinputstream;1', 'nsIBinaryInputStream', 'setInputStream');

/*
 * Light version of addon SDK Request object as the original displays errors in the console. 
 */
exports.Request = function(options) {
	function Listener() {
		this.data = [];
	}
	Listener.prototype = {
		onStartRequest: function(request,context) {
		},
		onDataAvailable: function(request,context,inputStream,offset,count) {
			var iStream = new BinaryInputStream(inputStream);
			this.data.push(iStream.readBytes(count));
			iStream.close();
		},
		onStopRequest: function(request,context,nsresult) {
			var httpChannel = request.QueryInterface(Ci.nsIHttpChannel);
			var responseStatus = httpChannel.responseStatus;
			var response = {
				status: httpChannel.responseStatus,
			}
			try {
			var data = this.data.join("");
			response.text = new String(data);
			if(options.onComplete)
				options.onComplete(response);
			} catch(e) {
				console.error("Error",e.message,e.stack);
			}
		},
	}
	
	Cu.import("resource://gre/modules/NetUtil.jsm");
    var channel = NetUtil.newChannel({
    	uri: options.url,
    	loadUsingSystemPrincipal: true,
    });
	if (channel instanceof Ci.nsIPrivateBrowsingChannel) {
		channel.setPrivate(!!options.isPrivate);
	}
	if (channel instanceof Ci.nsIHttpChannel && options.headers && options.headers.Referer) {
		channel.referrer = NetUtil.newURI(options.headers.Referer);
	}
	var listener = new Listener(this);
	channel.notificationCallbacks = listener;
	return {
		get: function() {
			channel.asyncOpen(listener, null);
		},
	}
} 

/*
 * Utility to download from a byte array 
 */
exports.DownloadToByteArray = function(url,headers,isPrivate,inhibitCache,callback) {
	function Listener() {
		this.data = [];
		this.iStream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci["nsIBinaryInputStream"]);
	}
	Listener.prototype = {
		onStartRequest: function(request,context) {
		},
		onDataAvailable: function(request,context,inputStream,offset,count) {
			this.iStream.setInputStream(inputStream);
			var bCount = 0;
			while(bCount<count) {
				var buffer = this.iStream.readByteArray(Math.min(count-bCount,this.iStream.available()));
				this.data.push(buffer);
				bCount += buffer.length;
			}
		},
		onStopRequest: function(request,context,nsresult) {
			try {
				this.iStream.close();
			} catch(e) {}
			var httpChannel = request.QueryInterface(Ci.nsIHttpChannel);
			var responseStatus = httpChannel.responseStatus;
			if(responseStatus!=200)
				return callback(new Error("Request response status "+responseStatus));
			var size = 0;
			for(var i=0, l=this.data.length;i<l;i++)
				size += this.data[i].length;
			var data = new Uint8Array(size);
			var offset = 0;
			for(var i=0, l=this.data.length;i<l;i++) {
				var dataChunk = this.data[i];
				data.set(dataChunk,offset);
				offset += dataChunk.length;
			}
			this.data = null;
			callback(null,data);
		},
	}	
	Cu.import("resource://gre/modules/NetUtil.jsm");
    var channel = NetUtil.newChannel({
    	uri: url,
    	loadUsingSystemPrincipal: true,
    });
	if (channel instanceof Ci.nsIPrivateBrowsingChannel) {
		channel.setPrivate(isPrivate);
	}
	if (channel instanceof Ci.nsIHttpChannel && headers && headers.Referer) {
		channel.referrer = NetUtil.newURI(headers.Referer);
	}
	if (channel instanceof Ci.nsIHttpChannel && inhibitCache) {
		channel.loadFlags = Ci.nsIRequest.INHIBIT_PERSISTENT_CACHING;
	}
	var listener = new Listener(this);
	channel.notificationCallbacks = listener;
	channel.asyncOpen(listener, null);
} 

var unicodeConverter = null;

exports.md5 = function(data) {
	if(!unicodeConverter) {
		unicodeConverter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
			.createInstance(Ci.nsIScriptableUnicodeConverter);
		unicodeConverter.charset = "UTF-8";
	}
	var jsonData = JSON.stringify(data);
	var bytes = unicodeConverter.convertToByteArray(jsonData, {});
	var ch = Cc["@mozilla.org/security/hash;1"]
		.createInstance(Ci.nsICryptoHash);
	ch.init(ch.MD5);
	ch.update(bytes,bytes.length);
	var data = ch.finish(false);
	return Array.from(data,function(c,i){return("0"+data.charCodeAt(i).toString(16)).slice(-2)}).join("");
};

exports.saveStringToFile = function(fileName,data,callback) {
	Cu.import("resource://gre/modules/osfile.jsm");
	OS.File.writeAtomic(fileName, data, { encoding: "utf-8" }).then(function() {
		//console.info("File saved as",fileName);
		if(callback)
			callback();
	},function(error) {
		console.info("error",error);
		if(callback)
			callback(error);
	});
}

var installHandlers = [];
var uninstallHandlers = [];
var windowListener = null;

Cu.import("resource://gre/modules/Services.jsm");

exports.browserWindowsTrack = function(install,uninstall) {
	if(install)
		installHandlers.push(install);
	if(uninstall)
		uninstallHandlers.push(uninstall);
	if(!windowListener) {
		windowListener = {
		    onOpenWindow: function(xulWindow) {
		        var window = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
		        function onWindowLoad() {
		            window.removeEventListener("load",onWindowLoad);
		            if (window.document.documentElement.getAttribute("windowtype") == "navigator:browser") {
		            	window.document.documentElement.setAttribute("vdh-monitored","1");
		            	installHandlers.forEach(function(install) {
		            		install(window);
		            	});
		            }
		        }
		        window.addEventListener("load",onWindowLoad);
		    },
		    onCloseWindow: function (xulWindow) {
		    	var window = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
		    	var monitored = false;
		    	try {
		    		monitored = window.document.documentElement.getAttribute("vdh-monitored");
		    	} catch($_) {};
		    	if(monitored) {
	            	uninstallHandlers.forEach(function(uninstall) {
	            		uninstall(window);
	            	});
	            	window.document.documentElement.removeAttribute("vdh-monitored");
		    	}
		    },
		}
		Services.wm.addListener(windowListener);
	}

	var en = Services.wm.getEnumerator("navigator:browser");
	while(en.hasMoreElements()) {
		var window = en.getNext().QueryInterface(Ci.nsIDOMWindow);
		window.document.documentElement.setAttribute("vdh-monitored","1");
		if(install)
			install(window);
	}
}

exports.browserWindowsTrackEnd = function(install,uninstall) {
	if(install) {
		var index = installHandlers.indexOf(install);
		if(index>=0)
			installHandlers.splice(index,1);
	}
	if(uninstall) {
		var index = uninstallHandlers.indexOf(uninstall);
		if(index>=0) {
			uninstallHandlers.splice(index,1);
			var en = Services.wm.getEnumerator("navigator:browser");
			while(en.hasMoreElements()) {
				var window = en.getNext().QueryInterface(Ci.nsIDOMWindow);
				uninstall(window);
			}			
		}
	}
}

exports.forEachBrowserWindow = function(callback) {
	var en = Services.wm.getEnumerator("navigator:browser");
	while(en.hasMoreElements()) {
		var window = en.getNext().QueryInterface(Ci.nsIDOMWindow);
		callback(window);
	}			
}

exports.gotoTab = function(url) {
	var tabs = require('sdk/tabs');
	var windows = require('sdk/windows');
	for(var tabId in tabs) {
		var tab = tabs[tabId];
		if(tab.url == url) {
			tab.activate();
			if(tab.window != windows.activeWindow)
				tab.window.activate();
			return;
		}
	}
}

exports.hashCode = function(str) {
	var hash = 0, i, chr, len;
	if (str.length === 0) return hash;
	for (i = 0, len = str.length; i < len; i++) {
		chr   = str.charCodeAt(i);
		hash  = ((hash << 5) - hash) + chr;
		hash |= 0; // Convert to 32bit integer
	}
	return hash;
}

require("sdk/system/unload").when(function() {
	if(windowListener) {
		Services.wm.removeListener(windowListener);
		windowListener = null;
		var en = Services.wm.getEnumerator("navigator:browser");
		while(en.hasMoreElements()) {
			var window = en.getNext().QueryInterface(Ci.nsIDOMWindow);
			window.document.documentElement.removeAttribute("vdh-monitored");
        	uninstallHandlers.forEach(function(uninstall) {
        		uninstall(window);
        	});
        	uninstallHandlers = [];
        	installHandlers = [];
		}
	}
});

;(function (exports) {
	'use strict'

	var i
	var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
		var lookup = []
	for (i = 0; i < code.length; i++) {
		lookup[i] = code[i]
	}
	var revLookup = []

	for (i = 0; i < code.length; ++i) {
		revLookup[code.charCodeAt(i)] = i
	}
	revLookup['-'.charCodeAt(0)] = 62
	revLookup['_'.charCodeAt(0)] = 63

	var Arr = (typeof Uint8Array !== 'undefined')
	? Uint8Array
			: Array

			function decode (elt) {
				var v = revLookup[elt.charCodeAt(0)]
				return v !== undefined ? v : -1
			}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = b64.charAt(len - 2) === '=' ? 2 : b64.charAt(len - 1) === '=' ? 1 : 0

				// base64 is 4/3 + up to two characters of the original data
				arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

				var L = 0

				function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push(((tmp & 0xFF0000) >>> 16) >>>0)
			push(((tmp & 0xFF00) >>> 8) >>>0)
			push((tmp & 0xFF) >>>0)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | ((decode(b64.charAt(i + 1)) >>> 4) >>>0)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | ((decode(b64.charAt(i + 2)) >>> 2) >>>0)
			push(((tmp >>> 8) >>>0) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function encode (num) {
		return lookup[num]
	}

	function tripletToBase64 (num) {
		return encode(((num >>> 18) >>>0) & 0x3F) + encode(((num >>> 12) >>>0) & 0x3F) + encode(((num >>> 6) >>>0) & 0x3F) + encode(num & 0x3F)
	}

	function encodeChunk (uint8, start, end) {
		var temp
		var output = []
		for (var i = start; i < end; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output.push(tripletToBase64(temp))
		}
		return output.join('')
	}

	function uint8ToBase64 (uint8) {
		var i
		var extraBytes = uint8.length % 3 // if we have 1 byte left, pad 2 bytes
		var output = ''
			var parts = []
		var temp, length
		var maxChunkLength = 16383 // must be multiple of 3

		// go through the array every three bytes, we'll deal with trailing stuff later

		for (i = 0, length = uint8.length - extraBytes; i < length; i += maxChunkLength) {
			parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > length ? length : (i + maxChunkLength)))
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
		case 1:
			temp = uint8[uint8.length - 1]
			output += encode((temp >>> 2) >>>0)
			output += encode((temp << 4) & 0x3F)
			output += '=='
			break
		case 2:
			temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
			output += encode((temp >>> 10) >>>0)
			output += encode(((temp >>> 4) >>>0) & 0x3F)
			output += encode((temp << 2) & 0x3F)
			output += '='
			break
		default:
			break
		}

		parts.push(output)

		return parts.join('')
	}

	exports.toByteArray = b64ToByteArray;
	exports.fromByteArray = uint8ToBase64;
}(exports))
