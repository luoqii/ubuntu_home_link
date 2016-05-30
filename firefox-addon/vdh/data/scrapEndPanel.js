/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHScrapEndCtrl', 
	['$scope', 'VDH.util',
	 	function($scope,VDHUtil) {
			VDHUtil.prepareScope($scope);
			$scope.launchFile = function() {
				$scope.post("launch",{ });
			}
			$scope.container = function() {
				$scope.post("container",{ });
			}
			$scope.convert = function() {
				$scope.post("convert",{ });
			}
	}]);

