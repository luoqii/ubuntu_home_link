/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


var width, height, offset, orgWidth, orgHeight, canvas, context, mouseX, mouseY, metaKey, pCanvas, pointerScale;
var mouse,haloRadius,haloColor,haloTransparency,pointerSize;
var capturing = false;
var t0, captured, skipped, options;

addMessageListener("vdh", function(message) {
	//if(message.data.type!="poll")
	//	console.info("frame script received message",message.data);
	var data = message.data;
	switch(data.type) {
	case "start": 
		StartCapture(data);
		break;
	case "stop": 
		StopCapture();
		break;
	case "get-geometry":
		GetGeometry(data);
		break;
	case "meta-key":
		metaKey = data.metaKey;
		break;
	case "poll":
		Capture();
		break;
	case "snapshot":
		TakeSnapshot(data);
		break;
	}
});

function TakeSnapshot(data) {
	var node = content.document.querySelector(data.selector);
	if(node) {
		var width = node.offsetWidth;
		var height = node.offsetHeight;
		var canvas = content.document.createElementNS("http://www.w3.org/1999/xhtml", "html:canvas");
		canvas.width = width;
		canvas.height = height;
		var context = canvas.getContext("2d");
		var offset = {
			top: 0,
			left: 0,
		}
		while(node) {
			offset.top += node.offsetTop;
			offset.left += node.offsetLeft;
			node = node.offsetParent;
		}
		context.drawWindow(content, offset.left, offset.top, width, height, "rgb(255,255,255)");
		sendAsyncMessage("vdh", {
			type: "snapshot",
			data: canvas.toDataURL(),
		});
		canvas.parentNode.removeChild(canvas);
	} else
		sendAsyncMessage("vdh", {
			type: "snapshot",
		});	
}

function GetGeometry(options) {
	width = content.innerWidth;
	height = content.innerHeight;
	offset = null;
	
	try {
		if(options.selector) {
			var node = content.document.querySelector(options.selector);
			if(node) {
				width = node.offsetWidth;
				height = node.offsetHeight;
				offset = {
					top: 0,
					left: 0,
				}
				while(node) {
					offset.top += node.offsetTop;
					offset.left += node.offsetLeft;
					node = node.offsetParent;
				}
			} else {
				sendAsyncMessage("vdh", {
					type: "error",
					error: "Element not found for selector "+options.selector,
				});
				return;
			}
		}
	} catch($_) {}

	orgWidth = width;
	orgHeight = height;

	switch(options.align) {
	case "cut":
		width &= ~7;
		height &= ~7;
		break;
	case "extend":
		width |= 7;
		height |= 7;
		break;
	}
	
	sendAsyncMessage("vdh", {
		type: "geometry",
		width: width,
		height: height,
		orgWidth: orgWidth,
		orgHeight: orgHeight,
		frameSize: width*height*4,
	});		
}

function CaptureMouse(event) {
	mouseX = event.clientX || event.pageX; 
    mouseY = event.clientY || event.pageY;
    metaKey = event.shiftKey;
}

function EnsureCanvas() {
	if(!canvas) {
		canvas = content.document.createElementNS("http://www.w3.org/1999/xhtml", "html:canvas");
		canvas.width = width;
		canvas.height = height;
		context = canvas.getContext("2d");
	}
	if(!pCanvas) {
		pCanvas = content.document.createElementNS("http://www.w3.org/1999/xhtml", "html:canvas");
		pCanvas.width=100*pointerScale;
		pCanvas.height=100*pointerScale;
		var pContext = pCanvas.getContext("2d");
		pContext.rotate(Math.PI/3.5);
		pContext.translate(-5,-5);
		pContext.beginPath();
		pContext.moveTo(5,5);
		pContext.lineTo(30*pointerScale+5,15*pointerScale+5);
		pContext.lineTo(30*pointerScale+5,5*pointerScale+5);
		pContext.lineTo(50*pointerScale+5,5*pointerScale+5);
		pContext.lineTo(50*pointerScale+5,-5*pointerScale+5);
		pContext.lineTo(30*pointerScale+5,-5*pointerScale+5);
		pContext.lineTo(30*pointerScale+5,-15*pointerScale+5);
		pContext.lineTo(5,5);
		pContext.lineWidth = 2;
		pContext.strokeStyle = "#000";
		pContext.stroke();
		pContext.fillStyle = "#fff";
		pContext.fill();		
	}
}

function GetStats() {
	var duration = Date.now() - t0;
	return {
		duration: Date.now() - t0,
		optimalFrameCount: Math.floor((duration*options.rate)/1000),
		captured: captured,
		skipped: skipped,
		width: width,
		height: height,
		orgWidth: orgWidth,
		orgHeight: orgHeight,
	}
}

function HandleEndCapture() {
	if(!capturing && options) {
		sendAsyncMessage("vdh", {
			type: "stats",
			stats: GetStats(),
		});
	}
}

function Capture() {

	if(!content || !options) {
		return;
	}
	
	EnsureCanvas();
	
	var duration = Date.now() - t0;
	if(captured > (duration*options.rate)/1000) {
		skipped++;
		return;
	}

	captured++;
	
	var x0, y0;
	if(offset) {
		x0 = offset.left;
		y0 = offset.top;
	} else {
		var x0 = content.scrollX;
		var y0 = content.scrollY;		
	}

	try {
		context.drawWindow(content, x0, y0, width, height, "rgb(255,255,255)");
	} catch($_) {
		canvas = pCanvas = null;
		return;
	}
	
	if(mouseX>=0 && mouseY>=0 && mouseX<width && mouseY<height && 
		(options.mouse=="always" || (options.mouse=="metakey" && metaKey) || (options.mouse=="not-metakey" && !metaKey))) {
	      if(options.haloRadius) {
		      context.beginPath();
		      context.arc(mouseX, mouseY, options.haloRadius, 0, 2 * Math.PI, false);
		      context.fillStyle = options.haloColor;
		      context.globalAlpha = 1-options.haloTransparency/100;
		      context.fill();		 
		      context.globalAlpha = 1;
	      }
	      if(options.pointerSize) {
	    	  context.drawImage(pCanvas,mouseX,mouseY);
	      }
	}
	
	try {
		imageData = context.getImageData(0,0,width,height);
	} catch(e) {
		return;
	}
	var data = imageData.data;

	sendAsyncMessage("vdh", {
		type: "frame",
		data: data,
		stats: GetStats(),
	});
}

function PageUnload(event) {
	if(options && options.stopOnPageUnload && content && event.target==content.document)
		StopCapture();
}

function StartCapture(_options) {
	if(capturing) {
		console.error("Already capturing");
		return;
	}
	capturing = true;
	options = _options;
	
	addEventListener("mousemove",CaptureMouse,false);
	addEventListener("mouseout",CaptureMouse,false);
	addEventListener("beforeunload",PageUnload,true);
	
	pointerScale = options.pointerSize/50;

	mouseX = mouseY = -1;
	metaKey = false;
	
	t0 = Date.now();
	captured = 0;
	skipped = 0;
	
	if(canvas) {
		try {
			canvas.parentNode.removeElement(canvas);
		} catch($_) {}
		canvas = null;
	}
	if(pCanvas) {
		try {
			pCanvas.parentNode.removeElement(pCanvas);
		} catch($_) {}
		pCanvas = null;
	}
	
}

function StopCapture() {
	if(!capturing) {
		console.error("Not capturing");
		return;
	}
	capturing = false;
	removeEventListener("mousemove",CaptureMouse,false);
	removeEventListener("mouseout",CaptureMouse,false);
	removeEventListener("beforeunload",PageUnload,true);
	HandleEndCapture();
}
