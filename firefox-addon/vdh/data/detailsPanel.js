/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHDetailsCtrl', 
	['$scope', 'VDH.util',
	 	function($scope,VDHUtil) {
			VDHUtil.prepareScope($scope);
			$scope.selected = {
				field: null, 
			}
			$scope.copyToClipboard = function() {
				var value = $scope.hit[$scope.selected.field];
				if(typeof value=="object")
					value = JSON.stringify(value);
				$scope.post("copy-to-url",{ value: value });
			}
	}]);

