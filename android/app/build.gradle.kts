plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
}

android {
    namespace = "ink.warrant"
    compileSdk = 35

    defaultConfig {
        applicationId = "ink.warrant"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // A RELEASE KEY, when there is one.
    //
    // The release build was signed with the DEBUG keystore. That key ships inside every Android
    // SDK install — it is the same key on every developer's machine on earth — so anyone can
    // produce a build Android considers the same application. It defeats update integrity, and
    // it defeats the Play Integrity app-identity signal this product records on captures and
    // reads back in `earnedTier()` as the `attested` rung. Recording an attestation for an
    // application anybody can impersonate is the same shape of mistake as trusting a shared
    // password to identify an instrument.
    //
    // Credentials come from the environment or gradle.properties, never from the tree: a
    // keystore committed beside the source is a keystore that has leaked.
    //
    //   WARRANT_KEYSTORE, WARRANT_KEYSTORE_PASSWORD, WARRANT_KEY_ALIAS, WARRANT_KEY_PASSWORD
    //
    // Absent, the release build is left UNSIGNED rather than silently falling back to the debug
    // key. An unsigned APK refuses to install and says why; a debug-signed one installs happily
    // and quietly carries the weaker claim, which is the failure worth preventing.
    val keystorePath: String? = System.getenv("WARRANT_KEYSTORE")
        ?: (project.findProperty("warrantKeystore") as String?)

    signingConfigs {
        if (keystorePath != null && file(keystorePath).exists()) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("WARRANT_KEYSTORE_PASSWORD")
                    ?: (project.findProperty("warrantKeystorePassword") as String? ?: "")
                keyAlias = System.getenv("WARRANT_KEY_ALIAS")
                    ?: (project.findProperty("warrantKeyAlias") as String? ?: "warrant")
                keyPassword = System.getenv("WARRANT_KEY_PASSWORD")
                    ?: (project.findProperty("warrantKeyPassword") as String? ?: "")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            // Shrink and obfuscate. Off meant the release APK shipped every class and method
            // name in the product, which is free reconnaissance for anyone reading it.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
            if (signingConfig == null) {
                logger.warn(
                    "warrant: no release keystore (set WARRANT_KEYSTORE). The APK will be " +
                        "UNSIGNED — deliberately, rather than falling back to the debug key, " +
                        "which every Android SDK install shares.",
                )
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.camerax.core)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.camerax.video)

    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.google.id)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.storage)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.play.integrity)

    implementation(libs.mlkit.face.detection)
    implementation(libs.mlkit.barcode.scanning)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
