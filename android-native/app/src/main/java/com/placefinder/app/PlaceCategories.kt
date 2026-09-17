package com.placefinder.app

data class UserPlaceCategory(
    val id: String,
    val section: String,
    val label: String,
    val googleTypes: Set<String>,
    val preferredPrimaryTypes: Set<String> = googleTypes
)

val USER_PLACE_CATEGORIES = listOf(

    // FOOD & DRINK

    UserPlaceCategory(
        id = "cafes",
        section = "Food & drink",
        label = "Cafés & coffee",
        googleTypes = setOf(
            "cafe",
            "coffee_shop"
        )
    ),

    UserPlaceCategory(
        id = "restaurants",
        section = "Food & drink",
        label = "Restaurants",
        googleTypes = setOf(
            "restaurant"
        )
    ),

    UserPlaceCategory(
        id = "fast_food",
        section = "Food & drink",
        label = "Fast food & takeaway",
        googleTypes = setOf(
            "fast_food_restaurant",
            "meal_takeaway",
            "sandwich_shop",
            "hamburger_restaurant",
            "pizza_restaurant"
        )
    ),

    UserPlaceCategory(
        id = "bars",
        section = "Food & drink",
        label = "Bars & drinks",
        googleTypes = setOf(
            "bar",
            "pub",
            "cocktail_bar",
            "wine_bar",
            "sports_bar",
            "night_club",
            "lounge_bar"
        )
    ),

    UserPlaceCategory(
        id = "bakeries",
        section = "Food & drink",
        label = "Bakeries & sweets",
        googleTypes = setOf(
            "bakery",
            "pastry_shop",
            "cake_shop",
            "dessert_shop",
            "ice_cream_shop"
        )
    ),

    // SHOPPING

    UserPlaceCategory(
        id = "groceries",
        section = "Shopping",
        label = "Groceries & supermarkets",
        googleTypes = setOf(
            "supermarket",
            "grocery_store",
            "convenience_store"
        )
    ),

    UserPlaceCategory(
        id = "clothing",
        section = "Shopping",
        label = "Clothing & fashion",
        googleTypes = setOf(
            "clothing_store",
            "shoe_store",
            "sportswear_store"
        )
    ),

    UserPlaceCategory(
        id = "electronics",
        section = "Shopping",
        label = "Electronics",
        googleTypes = setOf(
            "electronics_store",
            "cell_phone_store"
        )
    ),

    UserPlaceCategory(
        id = "home",
        section = "Shopping",
        label = "Home & furniture",
        googleTypes = setOf(
            "furniture_store",
            "home_goods_store",
            "hardware_store",
            "home_improvement_store"
        )
    ),

    UserPlaceCategory(
        id = "shopping_centres",
        section = "Shopping",
        label = "Shopping centres",
        googleTypes = setOf(
            "shopping_mall",
            "department_store"
        )
    ),

    UserPlaceCategory(
        id = "other_shops",
        section = "Shopping",
        label = "Other shops",
        googleTypes = setOf(
            "book_store",
            "gift_shop",
            "pet_store",
            "sporting_goods_store",
            "toy_store",
            "store"
        )
    ),

    // HEALTH

    UserPlaceCategory(
        id = "pharmacy",
        section = "Health",
        label = "Pharmacy",
        googleTypes = setOf(
            "pharmacy",
            "drugstore"
        )
    ),

    UserPlaceCategory(
        id = "doctor",
        section = "Health",
        label = "Doctor & clinic",
        googleTypes = setOf(
            "doctor",
            "medical_clinic",
            "medical_center"
        )
    ),

    UserPlaceCategory(
        id = "dentist",
        section = "Health",
        label = "Dentist",
        googleTypes = setOf(
            "dentist",
            "dental_clinic"
        )
    ),

    UserPlaceCategory(
        id = "hospital",
        section = "Health",
        label = "Hospital",
        googleTypes = setOf(
            "hospital",
            "general_hospital"
        )
    ),

    UserPlaceCategory(
        id = "wellness",
        section = "Health",
        label = "Spa & wellness",
        googleTypes = setOf(
            "spa",
            "wellness_center",
            "massage",
            "sauna"
        )
    ),

    // SPORT

    UserPlaceCategory(
        id = "gym",
        section = "Sport & fitness",
        label = "Gym & fitness",
        googleTypes = setOf(
            "gym",
            "fitness_center"
        )
    ),

    UserPlaceCategory(
        id = "swimming",
        section = "Sport & fitness",
        label = "Swimming",
        googleTypes = setOf(
            "swimming_pool"
        )
    ),

    UserPlaceCategory(
        id = "sports",
        section = "Sport & fitness",
        label = "Sports facilities",
        googleTypes = setOf(
            "sports_complex",
            "sports_club",
            "stadium",
            "athletic_field",
            "tennis_court"
        )
    ),

    UserPlaceCategory(
        id = "golf",
        section = "Sport & fitness",
        label = "Golf",
        googleTypes = setOf(
            "golf_course"
        )
    ),

    // TRANSPORT

    UserPlaceCategory(
        id = "parking",
        section = "Transport",
        label = "Parking",
        googleTypes = setOf(
            "parking",
            "parking_garage",
            "parking_lot",
            "park_and_ride"
        )
    ),

    UserPlaceCategory(
        id = "public_transport",
        section = "Transport",
        label = "Public transport",
        googleTypes = setOf(
            "transit_station",
            "transit_stop",
            "subway_station",
            "light_rail_station",
            "tram_stop"
        )
    ),

    UserPlaceCategory(
        id = "train",
        section = "Transport",
        label = "Train stations",
        googleTypes = setOf(
            "train_station"
        )
    ),

    UserPlaceCategory(
        id = "bus",
        section = "Transport",
        label = "Bus stations & stops",
        googleTypes = setOf(
            "bus_station",
            "bus_stop"
        )
    ),

    UserPlaceCategory(
        id = "fuel_charging",
        section = "Transport",
        label = "Fuel & EV charging",
        googleTypes = setOf(
            "gas_station",
            "electric_vehicle_charging_station"
        )
    ),

    UserPlaceCategory(
        id = "airport",
        section = "Transport",
        label = "Airports",
        googleTypes = setOf(
            "airport",
            "international_airport"
        )
    ),

    // EDUCATION

    UserPlaceCategory(
        id = "schools",
        section = "Education",
        label = "Schools",
        googleTypes = setOf(
            "school",
            "primary_school",
            "secondary_school"
        )
    ),

    UserPlaceCategory(
        id = "preschool",
        section = "Education",
        label = "Preschool",
        googleTypes = setOf(
            "preschool"
        )
    ),

    UserPlaceCategory(
        id = "university",
        section = "Education",
        label = "Universities",
        googleTypes = setOf(
            "university",
            "educational_institution"
        )
    ),

    UserPlaceCategory(
        id = "library",
        section = "Education",
        label = "Libraries",
        googleTypes = setOf(
            "library"
        )
    ),

    // LEISURE

    UserPlaceCategory(
        id = "parks",
        section = "Leisure & outdoors",
        label = "Parks",
        googleTypes = setOf(
            "park",
            "city_park",
            "national_park",
            "dog_park"
        )
    ),

    UserPlaceCategory(
        id = "outdoors",
        section = "Leisure & outdoors",
        label = "Outdoor activities",
        googleTypes = setOf(
            "hiking_area",
            "beach",
            "nature_preserve",
            "scenic_spot"
        )
    ),

    UserPlaceCategory(
        id = "museums",
        section = "Leisure & outdoors",
        label = "Museums & galleries",
        googleTypes = setOf(
            "museum",
            "art_gallery",
            "history_museum",
            "art_museum"
        )
    ),

    UserPlaceCategory(
        id = "cinema",
        section = "Leisure & outdoors",
        label = "Cinema & entertainment",
        googleTypes = setOf(
            "movie_theater",
            "bowling_alley",
            "amusement_center"
        )
    ),

    UserPlaceCategory(
        id = "attractions",
        section = "Leisure & outdoors",
        label = "Attractions",
        googleTypes = setOf(
            "tourist_attraction",
            "historical_landmark",
            "zoo",
            "aquarium"
        )
    ),

    UserPlaceCategory(
        id = "playground",
        section = "Leisure & outdoors",
        label = "Playgrounds",
        googleTypes = setOf(
            "playground",
            "indoor_playground"
        )
    ),

    // ACCOMMODATION

    UserPlaceCategory(
        id = "hotels",
        section = "Accommodation",
        label = "Hotels",
        googleTypes = setOf(
            "hotel",
            "motel",
            "resort_hotel"
        )
    ),

    UserPlaceCategory(
        id = "hostels",
        section = "Accommodation",
        label = "Hostels & guest houses",
        googleTypes = setOf(
            "hostel",
            "guest_house",
            "bed_and_breakfast"
        )
    ),

    UserPlaceCategory(
        id = "camping",
        section = "Accommodation",
        label = "Camping",
        googleTypes = setOf(
            "campground",
            "rv_park"
        )
    ),

    // SERVICES

    UserPlaceCategory(
        id = "hair_beauty",
        section = "Services",
        label = "Hair & beauty",
        googleTypes = setOf(
            "hair_salon",
            "barber_shop",
            "beauty_salon",
            "nail_salon"
        )
    ),

    UserPlaceCategory(
        id = "laundry",
        section = "Services",
        label = "Laundry",
        googleTypes = setOf(
            "laundry"
        )
    ),

    UserPlaceCategory(
        id = "banking",
        section = "Services",
        label = "Bank & ATM",
        googleTypes = setOf(
            "bank",
            "atm"
        )
    ),

    UserPlaceCategory(
        id = "post_shipping",
        section = "Services",
        label = "Post & shipping",
        googleTypes = setOf(
            "post_office",
            "shipping_service",
            "courier_service"
        )
    ),

    UserPlaceCategory(
        id = "car_services",
        section = "Services",
        label = "Car services",
        googleTypes = setOf(
            "car_repair",
            "car_wash",
            "tire_shop"
        )
    ),

    UserPlaceCategory(
        id = "pets",
        section = "Services",
        label = "Pet services",
        googleTypes = setOf(
            "veterinary_care",
            "pet_store",
            "pet_care"
        )
    )
)

fun googleTypesForCategories(
    selectedCategoryIds: Set<String>
): Set<String> {
    return USER_PLACE_CATEGORIES
        .filter {
            it.id in selectedCategoryIds
        }
        .flatMap {
            it.googleTypes
        }
        .toSet()
}

fun preferredPrimaryTypesForCategories(
    selectedCategoryIds: Set<String>
): Set<String> {
    return USER_PLACE_CATEGORIES
        .filter {
            it.id in selectedCategoryIds
        }
        .flatMap {
            it.preferredPrimaryTypes
        }
        .toSet()
}