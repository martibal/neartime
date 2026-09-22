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

android {
    namespace = "com.placefinder.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.placefinder.app"
        minSdk = 24
        targetSdk = 37
        versionCode = 17
        versionName = "1.0.17-production"

        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
        manifestPlaceholders["APP_LABEL"] = "WayNear"
        buildConfigField("String", "ADMIN_TEST_TOKEN", "\"\"")
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["APP_LABEL"] = "WayNear"
        }

        getByName("release") {
            manifestPlaceholders["APP_LABEL"] = "WayNear"
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
