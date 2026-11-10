plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.chasevandiver.tvoverlay"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.chasevandiver.tvoverlay"
        // Fire OS 5 is API 22; every Fire OS TV and the 4K Max sit above it.
        minSdk = 22
        // Fire OS 8 is Android 11 (API 30). Targeting it keeps the foreground
        // service rules of Android 14 out of the way for a sideloaded app.
        targetSdk = 30
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    signingConfigs {
        // A committed debug-style key so every CI build is signed with the same
        // key and installs over the previous one. This app is never published
        // to a store; the key protects nothing.
        create("sideload") {
            storeFile = file("sideload.keystore")
            storePassword = "tvoverlay"
            keyAlias = "tvoverlay"
            keyPassword = "tvoverlay"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
    packaging {
        resources.excludes += setOf(
            "META-INF/*.kotlin_module",
            "META-INF/versions/**",
            "META-INF/LICENSE*",
            "META-INF/NOTICE*",
            "META-INF/DEPENDENCIES",
            "META-INF/INDEX.LIST",
        )
    }
}

dependencies {
    // Pure-Kotlin ADB client: lets the app talk to the TV's own ADB on
    // 127.0.0.1:5555 and grant itself the overlay permission, no laptop needed.
    implementation("dev.mobile:dadb:1.2.9")
}
