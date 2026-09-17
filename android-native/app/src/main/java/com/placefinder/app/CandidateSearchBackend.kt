package com.placefinder.app

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

data class SearchPlace(
    val id: String,
    val name: String,
    val rating: Double?,
    val userRatingCount: Int?,
    val isOpenNow: Boolean?,
    val primaryType: String?,
    val walkMinutes: Int,
    val walkDistanceMeters: Int,
    val encodedPolyline: String
)

data class SearchStats(
    val candidateIds: Int,
    val routedCandidates: Int,
    val walkTimeMatches: Int,
    val returnedPlaces: Int,
    val maxWalkMinutes: Int
)

data class SearchCost(
    val aggregateRequests: Int,
    val computeRouteRequests: Int,
    val placeDetailsRequests: Int,
    val estimatedExternalCostUsd: Double
)

data class CompleteSearchResponse(
    val searchId: Int,
    val places: List<SearchPlace>,
    val stats: SearchStats,
    val cost: SearchCost
)

object CandidateSearchBackend {

    private const val TAG =
        "CandidateSearch"

    /*
     * adb reverse tcp:8081 tcp:8081
     */
    private const val BASE_URL =
        "http://127.0.0.1:8081"

    suspend fun search(
        latitude: Double,
        longitude: Double,
        includedPrimaryTypes: Set<String>,
        minRating: Double?,
        maxWalkMinutes: Int,
        openNowOnly: Boolean
    ): CompleteSearchResponse =
        withContext(
            Dispatchers.IO
        ) {

            val connection =
                URL(
                    "$BASE_URL/search"
                )
                    .openConnection()
                        as HttpURLConnection

            try {
                connection.requestMethod =
                    "POST"

                connection.connectTimeout =
                    15_000

                /*
                 * Complete search can contain several
                 * Google route/detail requests.
                 */
                connection.readTimeout =
                    120_000

                connection.doInput =
                    true

                connection.doOutput =
                    true

                connection.useCaches =
                    false

                connection.setRequestProperty(
                    "Content-Type",
                    "application/json; charset=UTF-8"
                )

                connection.setRequestProperty(
                    "Accept",
                    "application/json"
                )

                val body =
                    JSONObject().apply {

                        put(
                            "latitude",
                            latitude
                        )

                        put(
                            "longitude",
                            longitude
                        )

                        put(
                            "includedPrimaryTypes",
                            JSONArray(
                                includedPrimaryTypes
                                    .toList()
                            )
                        )

                        if (
                            minRating !=
                            null
                        ) {
                            put(
                                "minRating",
                                minRating
                            )
                        }

                        put(
                            "maxWalkMinutes",
                            maxWalkMinutes
                        )

                        put(
                            "openNowOnly",
                            openNowOnly
                        )
                    }

                val payload =
                    body.toString()
                        .toByteArray(
                            Charsets.UTF_8
                        )

                connection
                    .setFixedLengthStreamingMode(
                        payload.size
                    )

                connection.connect()

                connection
                    .outputStream
                    .use { stream ->

                        stream.write(
                            payload
                        )

                        stream.flush()
                    }

                val status =
                    connection.responseCode

                val input =
                    if (
                        status in
                        200..299
                    ) {
                        connection.inputStream
                    } else {
                        connection.errorStream
                    }

                val text =
                    if (
                        input !=
                        null
                    ) {

                        BufferedReader(
                            InputStreamReader(
                                input,
                                Charsets.UTF_8
                            )
                        ).use {
                            it.readText()
                        }

                    } else {
                        ""
                    }

                Log.d(
                    TAG,
                    "HTTP $status: $text"
                )

                if (
                    status !in
                    200..299
                ) {
                    val json =
                        runCatching {
                            JSONObject(
                                text
                            )
                        }
                            .getOrNull()

                    val message =
                        json
                            ?.optString(
                                "message"
                            )
                            ?.takeIf {
                                it.isNotBlank()
                            }
                            ?: json
                                ?.optString(
                                    "error"
                                )
                            ?: text

                    throw IllegalStateException(
                        message
                    )
                }

                parseSearchResponse(
                    JSONObject(
                        text
                    )
                )

            } finally {
                connection.disconnect()
            }
        }

    private fun parseSearchResponse(
        json: JSONObject
    ): CompleteSearchResponse {

        val placesJson =
            json.optJSONArray(
                "places"
            ) ?: JSONArray()

        val places =
            buildList {

                for (
                index in
                0 until
                        placesJson.length()
                ) {
                    val item =
                        placesJson
                            .getJSONObject(
                                index
                            )

                    add(
                        SearchPlace(
                            id =
                                item.getString(
                                    "id"
                                ),

                            name =
                                item.getString(
                                    "name"
                                ),

                            rating =
                                if (
                                    item.isNull(
                                        "rating"
                                    )
                                ) {
                                    null
                                } else {
                                    item.getDouble(
                                        "rating"
                                    )
                                },

                            userRatingCount =
                                if (
                                    item.isNull(
                                        "userRatingCount"
                                    )
                                ) {
                                    null
                                } else {
                                    item.getInt(
                                        "userRatingCount"
                                    )
                                },

                            isOpenNow =
                                if (
                                    item.isNull(
                                        "isOpenNow"
                                    )
                                ) {
                                    null
                                } else {
                                    item.getBoolean(
                                        "isOpenNow"
                                    )
                                },

                            primaryType =
                                if (
                                    item.isNull(
                                        "primaryType"
                                    )
                                ) {
                                    null
                                } else {
                                    item.getString(
                                        "primaryType"
                                    )
                                },

                            walkMinutes =
                                item.getInt(
                                    "walkMinutes"
                                ),

                            walkDistanceMeters =
                                item.getInt(
                                    "walkDistanceMeters"
                                ),

                            encodedPolyline =
                                item.getString(
                                    "encodedPolyline"
                                )
                        )
                    )
                }
            }

        val statsJson =
            json.getJSONObject(
                "stats"
            )

        val costJson =
            json.getJSONObject(
                "cost"
            )

        return CompleteSearchResponse(
            searchId =
                json.getInt(
                    "searchId"
                ),

            places =
                places,

            stats =
                SearchStats(
                    candidateIds =
                        statsJson.optInt(
                            "candidateIds",
                            0
                        ),

                    routedCandidates =
                        statsJson.optInt(
                            "routedCandidates",
                            0
                        ),

                    walkTimeMatches =
                        statsJson.optInt(
                            "walkTimeMatches",
                            0
                        ),

                    returnedPlaces =
                        statsJson.optInt(
                            "returnedPlaces",
                            places.size
                        ),

                    maxWalkMinutes =
                        statsJson.optInt(
                            "maxWalkMinutes",
                            15
                        )
                ),

            cost =
                SearchCost(
                    aggregateRequests =
                        costJson.optInt(
                            "aggregateRequests",
                            0
                        ),

                    computeRouteRequests =
                        costJson.optInt(
                            "computeRouteRequests",
                            0
                        ),

                    placeDetailsRequests =
                        costJson.optInt(
                            "placeDetailsRequests",
                            0
                        ),

                    estimatedExternalCostUsd =
                        costJson.optDouble(
                            "estimatedExternalCostUsd",
                            0.0
                        )
                )
        )
    }
}