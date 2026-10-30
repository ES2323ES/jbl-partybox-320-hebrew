plugins {
    id("com.android.application")
}

android {
    namespace = "com.jblpartybox320.hebrewcontrol"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jblpartybox320.hebrewcontrol"
        minSdk = 24
        targetSdk = 34
        versionCode = 6
        versionName = "0.4.0"
    }

    signingConfigs {
        create("release") {
            val keystoreFile = file("jbl-release-key.jks")
            if (keystoreFile.exists()) {
                storeFile = keystoreFile
                storePassword = System.getenv("SIGNING_STORE_PASSWORD") ?: "jblpb320hebrew"
                keyAlias = System.getenv("SIGNING_KEY_ALIAS") ?: "jbl320key"
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD") ?: "jblpb320hebrew"
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val keystoreFile = file("jbl-release-key.jks")
            if (keystoreFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            val keystoreFile = file("jbl-release-key.jks")
            if (keystoreFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
