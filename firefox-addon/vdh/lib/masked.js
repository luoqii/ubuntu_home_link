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
const Cr = $chrome.Cr;
const $osfile = Cu.import("resource://gre/modules/osfile.jsm", {});
const OS = $osfile.OS;
const btoa = Cu.import("resource://gre/modules/Services.jsm", {}).btoa;
const path = require("sdk/fs/path");
const passwords = require("sdk/passwords");
const self = require("sdk/self");
const simplePrefs = require("sdk/simple-prefs");
const tabs = require("sdk/tabs");

const merge = require('sdk/util/object').merge;
const _ = require("sdk/l10n").get;

const alerts = require("./alerts");

const defaultPassword = "DNqRTjpphSG12";

const BLOCKSIZE = 8 * 1024;
const PASSWORD_USERNAME = "anybody";
const PASSWORD_REALM = "Video DownloadHelper Masked Download";

var maskedKey = null;

const unicodeConverter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Ci.nsIScriptableUnicodeConverter);
unicodeConverter.charset = "UTF-8";

Cu.importGlobalProperties(["crypto"]);

exports.prepareMaskedAction = function(action,callback) {

	exports.getPassword(function(password) {
		crypto.subtle.digest({ name: "SHA-256" },new Uint8Array(unicodeConverter.convertToByteArray(password)))
			.then(function(hash) {
				crypto.subtle.digest({ name: "SHA-256" },new Uint8Array(hash))
					.then(function(keySign) {
					action.cryptoKeySign = new Uint8Array(keySign);
					action.biniv = new Uint8Array(16);
					crypto.getRandomValues(action.biniv);
					crypto.subtle.importKey(
						"raw",
						new Uint8Array(hash),
						{
							"name": "AES-CTR",
						},
						false,
						["encrypt"]).then(function(key) {
							action.cryptoKey = key;
							callback(null);
					});
				}).catch(function(err) {
					callback(err);
				});
			})
			.catch(function(err){
				callback(err);
			});
	});
}

exports.finalize = function(action,manifestFilePath,callback) {
	var meta = {};
	for(var f in action.hit.data)
		if(f[0]!='_')
			meta[f] = action.hit.data[f];

	var metaiv = new Uint8Array(16);
	crypto.getRandomValues(metaiv);

	var manifest = {
		biniv: btoa(String.fromCharCode.apply(null, action.biniv)),
		metaiv: btoa(String.fromCharCode.apply(null, metaiv)),
		keySign: btoa(String.fromCharCode.apply(null, action.cryptoKeySign)),
	}
	var metaBytes = new Uint8Array(unicodeConverter.convertToByteArray(JSON.stringify(meta)));
	
	var bits = require("./bits");
	
	crypto.subtle.encrypt({
		name: "AES-CTR",
        counter: metaiv,
        length: 128,
    },
    action.cryptoKey,
    metaBytes
    ).then(function(encrypted){
    	encrypted = new Uint8Array(encrypted);
    	manifest.meta = btoa(String.fromCharCode.apply(null, encrypted));
    	OS.File.open(manifestFilePath,{write:true,append:false,truncate: true}).then(function(file) {
    		var bytes = unicodeConverter.convertToByteArray(JSON.stringify(manifest));
    		var metaBytes = new Uint8Array(bytes);
    		file.write(metaBytes).then(function() {
    			file.close();
    			callback(null);
    		},function(err) {
    			file.close();
    			callback(err);
    		});
    	},function(err) {
	    	callback(err);						    								    		
    	});
    },function(err) {
    	callback(err);
    });
}

exports.makeFileNames = function(filePath) {		
	var baseFilePath = path.resolve(path.dirname(filePath),  path.basename(filePath, path.extname(filePath)));
	return {
		filePath: filePath,
		baseFilePath: baseFilePath,
		manifestFilePath: baseFilePath+".vdh",
		binFilePath: baseFilePath+".bin",
	}
}

function Listener(callback) {
	this.callback = callback;
	this.iStream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci["nsIBinaryInputStream"]);
	this.currentBlockSize = 0;
	this.currentBlock = [];
	this.contentLength = 0;
	this.currentSize = 0;
}
Listener.prototype = {
	sendBuffer: function(buffer,done) {
		if(buffer) {
			this.currentBlock.push(buffer);
			this.currentBlockSize += buffer.length;
		}
		if(this.currentBlockSize==BLOCKSIZE || done) {
			var data = null;
			if(this.currentBlock.length==1)
				data = new Uint8Array(this.currentBlock[0]);
			else if(this.currentBlock.length>1) {
				data = new Uint8Array(this.currentBlockSize);
				var offset = 0;
				while(offset<this.currentBlockSize) {
					var buf = this.currentBlock.shift();
					data.set(buf,offset);
					offset += buf.length;
				}
			}
			this.currentBlockSize = 0;
			this.currentBlock = [];
			var progress = (this.contentLength &&
				Math.min(Math.round(this.currentSize*100/this.contentLength),100)) || 0;
			if(!this.callback(null,data,done,progress))
				this.channel.cancel(Cr.NS_BINDING_ABORTED);
		}
	},
	onStartRequest: function(request,context) {
		try {
			this.contentLength = parseInt(request.getResponseHeader("content-length"));
		} catch(e) {}
	},
	onDataAvailable: function(request,context,inputStream,offset,count) {
		this.iStream.setInputStream(inputStream);
		var bytesToRead = this.iStream.available();
		while(bytesToRead>0) {
			var chunkSize = Math.min(bytesToRead,BLOCKSIZE-this.currentBlockSize);
			var buffer = this.iStream.readByteArray(chunkSize);
			bytesToRead -= chunkSize;
			this.currentSize += chunkSize;
			this.sendBuffer(buffer,false);
		}
	},
	onStopRequest: function(request,context,nsresult) {
		try {
			this.iStream.close();
		} catch(e) {}
		var httpChannel = request.QueryInterface(Ci.nsIHttpChannel);
		var responseStatus = httpChannel.responseStatus;
		if(responseStatus!=200)
			return this.callback(new Error("Request response status "+responseStatus));
		this.sendBuffer(null,true);
	},
}

exports.MaskedDownload = function(url,referrer,callback) {
	var ios=Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
	var uri = ios.newURI(url, null, null);
	var channel = ios.newChannelFromURI(uri);
	var httpChannel = channel.QueryInterface(Ci.nsIHttpChannel);
	httpChannel.loadFlags = Ci.nsIRequest.INHIBIT_PERSISTENT_CACHING;
	httpChannel.requestMethod = "GET";
	var listener = new Listener(callback);
	channel.notificationCallbacks = listener;
	if(referrer) {
		var referrerUri = ios.newURI(referrer, null, null);
		httpChannel.referrer = referrerUri;
	}
	listener.channel = channel;
	channel.asyncOpen(listener, null);
}

function Write32(data,offset,value) {
	data[offset] = (value >> 24) & 0xff;
	data[offset+1] = (value >> 16) & 0xff;
	data[offset+2] = (value >> 8) & 0xff;
	data[offset+3] = value & 0xff;
}

function Read32(data,offset) {
	var v = ((data[offset] << 24) + (data[offset+1] << 16) + (data[offset+2] << 8) + data[offset+3]) >>> 0;
	return v;
}

function IncrementCounter(ivBytes,incr) {
	var lower = (incr  & 0xffffffff) >>> 0;
	var upper = Math.floor(incr / 0x100000000);
	var prev = Read32(ivBytes,12);
	var v = ((prev+lower) & 0xffffffff) >>> 0;
	Write32(ivBytes,12,v);
	if(v<prev)
		upper++;
	if(upper==0)
		return;
	prev = Read32(ivBytes,8);
	v = ((prev+upper) & 0xffffffff) >>> 0;
	Write32(ivBytes,8,v);
	if(v<prev) {
		prev = Read32(ivBytes,4);
		v = ((prev+1) & 0xffffffff) >>> 0;
		Write32(ivBytes,4,v);
		if(v<prev) {
			prev = Read32(ivBytes,0);
			v = ((prev+1) & 0xffffffff) >>> 0;
			Write32(ivBytes,0,v);			
		}
	}
}

function MaskedInfo() {
	if(!simplePrefs.prefs['masked.info-not-again']) {
		alerts.alert({
			title: _('masked.info.title'),
			text: [
				_('masked.info.descr1'),
				_('masked.info.descr2'),
			],
			button: [{
				text: _('masked.close'),
				click: "post('close')",
			},{
				text: _('masked.more'),
				click: "post('more')",
				buttonClass: 'btn-success',
			}],
			notAgain: 'masked.info-not-again',
			onMessage: function(message,panel) {
				switch(message.type) {
				case "close":
					panel.hide();
					break;
				case "more":
					panel.hide();
					tabs.open({
						url: "http://www.downloadhelper.net/masked-download-info",
					});
					break;
				}
			},
		});
	}
}

exports.info = MaskedInfo;

function File(fd) {
	this.offset = 0;
	this.fileSize = 0;
}
File.prototype = {
	notImplemented: function() {
		throw new Error("Not implemented");		
	},
	read: function() {
		this.notImplemented();
	},
	writeClear: function(block) {
		var self = this;
		var args = arguments;
		this.offset += block.length;
		this.fileSize = Math.max(this.fileSize,this.offset);
		return self.fd.write.apply(self.fd,args);
	},
	write: function(block) {
		if(!this.options.key || !this.options.iv)
			return this.writeClear.apply(this,arguments);
		var self = this;
		var args = arguments;
		var blockCount = Math.floor(this.offset/16);
		var shift = this.offset % 16;
		var ivBytes = new Uint8Array(this.options.iv);
		IncrementCounter(ivBytes,blockCount);
		var block2;
		if(shift) {
			block2 = new Uint8Array(block.length+shift);
			block2.set(block,shift);
		} else
			block2 = block;
		return new Promise(function(resolve,reject) {
			var t0 = Date.now();
			crypto.subtle.encrypt({
				name: "AES-CTR",
		        counter: ivBytes,
		        length: 128,
		    },
		    self.options.key,
		    block2).then(function(encrypted){
		    	encrypted = new Uint8Array(encrypted);
		    	if(shift)
		    		args[0] = encrypted.subarray(shift,block.length+shift);
		    	else
		    		args[0] = encrypted;
		    	var t01 = Date.now();
		    	self.writeClear.apply(self,args).then(function() {
		    		resolve.apply(self,arguments);
		    	},function() {
		    		reject.apply(self,arguments);
		    	});
		    },function(err) {
		    	reject(err);
		    });
		});
	},
	close: function() {
		var self = this;
		var args = arguments;
		return new Promise(function(resolve,reject) {
			self.fd.close.apply(self.fd,args).then(function(written) {
				resolve(written);
			},function(err) {
				reject(err);
			});
		});		
	},
	setPosition: function(offset,origin) {
		var self = this;
		var args = arguments;
		return new Promise(function(resolve,reject) {
			self.fd.setPosition.apply(self.fd,args).then(function() {
				if(origin==OS.File.POS_START) {
					self.offset = offset;
				} else if(origin==OS.File.POS_CUR)
					self.offset += offset;
				else if(origin==OS.File.POS_END) {
					self.offset = self.fileSize - offset;
				}
				resolve();
			},function(err) {
				reject(err);
			});
		});		
	},
}

exports.File = {
	open: function() {
		var args = arguments;
		return new Promise(function(resolve,reject) {
			var options = merge({},args[1]);
			if(args[1]) {
				delete args[1].key;
				delete args[1].iv;
			}
			OS.File.open.apply(OS.File,args).then(function(fd) {
				var file = new File();
				file.fd = fd;
				file.options = options;
				file.offset = file.fileSize = 0;
				if(!options.truncate) {
					fd.stat().then(function(info) {
						file.fileSize = info.size;
						if(options.append)
							file.offset = info.size;
						resolve(file);
					},function(err) {
						fd.close();
						reject(err);
					});
				} else
					resolve(file);
			},function(err) {
				reject(err);
			});
		});
	},
}

exports.getPassword = function(callback) {
	if(simplePrefs.prefs['masked.default-password'])
		callback(defaultPassword);
	else
		passwords.search({
			url: self.uri,
			realm: PASSWORD_REALM,
			username: PASSWORD_USERNAME,
			onComplete: function onComplete(credentials) {
				if(credentials.length==0)
					callback(defaultPassword);
				else
					callback(credentials[0].password);
			}
		});
}

exports.setPassword = function(password) {
	passwords.store({
		url: self.uri,
  		realm: PASSWORD_REALM,
  		username: PASSWORD_USERNAME,
  		password: password
	});
}
