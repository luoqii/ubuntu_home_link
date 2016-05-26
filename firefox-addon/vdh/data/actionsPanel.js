/* Copyright (C) 2006-2016 Michel Gutierrez <mig@downloadhelper.net>
 * All Rights Reserved
 * 
 * If you are interested in methods used in this project, follow the
 * open source project at https://github.com/mi-g/fang
 */


angular.module('VDH').controller('VDHActionsCtrl', 
	['$scope', 'VDH.util',
	 	function($scope,VDHUtil) {
			VDHUtil.prepareScope($scope);
			$scope.command = function(action) {
				$scope.post("actionCommand",{
					action: action,
					hit: $scope.hit,
					asDefault: $scope.data.asDefault,
				});
			}
			$scope.data = {
				asDefault: false,
			}
	}]);

