import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use(::load)
    }
}

val mapsApiKey = localProperties.getProperty("MAPS_API_KEY", "")
val adminTestToken = localProperties
    .getProperty("WAYNEAR_ADMIN_TEST_TOKEN", "")
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

val uploadStoreFile = localProperties.getProperty("WAYNEAR_UPLOAD_STORE_FILE", "")
val uploadKeyAlias = localProperties.getProperty("WAYNEAR_UPLOAD_KEY_ALIAS", "")
val uploadStorePassword = localProperties.getProperty("WAYNEAR_UPLOAD_STORE_PASSWORD", "")
val uploadKeyPassword = localProperties.getProperty("WAYNEAR_UPLOAD_KEY_PASSWORD", "")

android {
    namespace = "com.placefinder.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.placefinder.app"
        minSdk = 24
        targetSdk = 37
        versionCode = 18
        versionName = "1.0.18-production"

        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
        manifestPlaceholders["APP_LABEL"] = "WayNear"
        buildConfigField("String", "ADMIN_TEST_TOKEN", "\"\"")
    }

    signingConfigs {
        create("release") {
            require(uploadStoreFile.isNotBlank()) {
                "WAYNEAR_UPLOAD_STORE_FILE is missing from local.properties"
            }
            require(uploadKeyAlias.isNotBlank()) {
                "WAYNEAR_UPLOAD_KEY_ALIAS is missing from local.properties"
            }
            require(uploadStorePassword.isNotBlank()) {
                "WAYNEAR_UPLOAD_STORE_PASSWORD is missing from local.properties"
            }
            require(uploadKeyPassword.isNotBlank()) {
                "WAYNEAR_UPLOAD_KEY_PASSWORD is missing from local.properties"
            }

            storeFile = file(uploadStoreFile)
            storePassword = uploadStorePassword
            keyAlias = uploadKeyAlias
            keyPassword = uploadKeyPassword
        }
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["APP_LABEL"] = "WayNear"
        }

        getByName("release") {
            manifestPlaceholders["APP_LABEL"] = "WayNear"
            signingConfig = signingConfigs.getByName("release")
        }

        create("admin") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".admin"
            versionNameSuffix = "-admin"
            signingConfig = signingConfigs.getByName("debug")
            isDebuggable = true
            manifestPlaceholders["APP_LABEL"] = "WayNear Admin"
            buildConfigField("String", "ADMIN_TEST_TOKEN", "\"$adminTestToken\"")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    implementation("com.google.maps.android:maps-compose:6.12.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.android.billingclient:billing-ktx:9.1.0")

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
