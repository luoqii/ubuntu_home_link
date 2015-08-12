export JAVA_HOME=/mnt/big_storage/jdk1.7.0_55
export ANDROID_SDK=/mnt/big_storage/android_sdk

export ANDROID_HOME=$ANDROID_SDK

export PATH=$JAVA_HOME/bin:$PATH
export PATH=$ANDROID_SDK/tools:$ANDROID_SDK/platform-tools:$ANDROID_SDK/tools/proguard/bin:$PATH
export PATH=~/bin:$PATH

#export USE_CCACHE=1
# use ~/.ccache whick link to real cache dir.
#export CCACHE_DIR=/mnt/big_storage/source/android.ccache

