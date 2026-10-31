package com.diettracker.googleauth

import android.accounts.Account
import android.app.Activity
import android.content.Context
import android.content.Intent

import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.ReactApplicationContext

import com.google.android.gms.auth.api.identity.AuthorizationClient
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.Scope

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Native Google authorization for Android (spec 7.1), built on the current
 * Google Identity Services stack:
 *
 *  - `com.google.android.gms.auth.api.identity.AuthorizationClient` performs
 *    the account selection and consent. When a saved grant still covers the
 *    requested scopes the access token comes back SILENTLY; only a missing
 *    grant produces a [AuthorizationResult.getPendingIntent], and that is
 *    launched exclusively for interactive flows. Background sync refuses to
 *    launch UI (AUTH_REQUIRED) so the sync engine can raise
 *    AuthenticationRequired without ever opening a login screen.
 *  - The OAuth client is the "Android" registration identified by package
 *    name + SHA-1 (RFC 8252 native client). No client secret exists in this
 *    flow, so nothing confidential is embedded in the build.
 *  - No server revoke calls are ever made (revokeAccess stays unused).
 */
class GoogleAuthModule : Module() {
  /** The promise of an interactive authorization waiting for onActivityResult. */
  private var pendingAuthorization: Promise? = null

  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_CODE) {
        return
      }
      val promise = pendingAuthorization ?: return
      pendingAuthorization = null
      if (resultCode != Activity.RESULT_OK || data == null) {
        promise.reject("AUTH_CANCELLED", "The Google authorization was cancelled.", null)
        return
      }
      try {
        val context: Context = appContext.reactContext
          ?: throw IllegalStateException("The application context is not ready.")
        val result = Identity.getAuthorizationClient(context)
          .getAuthorizationResultFromIntent(data)
        promise.resolve(authorizationPayload(result))
      } catch (error: Exception) {
        promise.reject("AUTH_ERROR", error.message ?: "The Google authorization failed.", error)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("GoogleAuth")

    OnCreate {
      (appContext.reactContext as? ReactApplicationContext)
        ?.addActivityEventListener(activityListener)
    }

    OnDestroy {
      (appContext.reactContext as? ReactApplicationContext)
        ?.removeActivityEventListener(activityListener)
    }

    /**
     * True when Google Play services are usable. With `showDialog` the
     * standard "update Play services" dialog is shown when resolvable.
     */
    Function("playServicesAvailable") { showDialog: Boolean ->
      val target: Context? = appContext.currentActivity ?: appContext.reactContext
      if (target == null) {
        return@Function false
      }
      val availability = GoogleApiAvailability.getInstance()
      val status = availability.isGooglePlayServicesAvailable(target)
      val available = status == ConnectionResult.SUCCESS
      if (!available && showDialog) {
        appContext.currentActivity?.let { activity ->
          availability.getErrorDialog(activity, status, REQUEST_CODE)?.show()
        }
      }
      available
    }

    /**
     * Requests an access token for `scopes` (spec 7.1.1 - openid, email,
     * profile, drive.appdata). Resolution order:
     *  1. silent token when the saved grant covers the scopes,
     *  2. otherwise the GIS authorization UI (account chooser + consent):
     *     launched only when `interactive` is true and an activity is in the
     *     foreground, completed through [activityListener],
     *  3. otherwise rejected with AUTH_REQUIRED (no UI in background paths).
     *
     * `selectAccount` forces the GIS account chooser (Prompt.SELECT_ACCOUNT)
     * so an explicit sign-in always lets the user pick the account - the
     * mobile equivalent of the desktop "choose account" page.
     */
    AsyncFunction("authorize") { scopes: List<String>, accountName: String?, selectAccount: Boolean, interactive: Boolean, promise: Promise ->
      try {
        val context: Context = appContext.reactContext
          ?: run {
            promise.reject("NO_CONTEXT", "The application context is not ready.", null)
            return@AsyncFunction
          }
        val builder = AuthorizationRequest.builder()
          .setRequestedScopes(scopes.map { Scope(it) })
        if (!accountName.isNullOrEmpty()) {
          builder.setAccount(Account(accountName, "com.google"))
        }
        if (selectAccount) {
          builder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
        }
        val client = Identity.getAuthorizationClient(context)
        client.authorize(builder.build()).addOnCompleteListener { task ->
          if (!task.isSuccessful) {
            val cause = task.exception
            promise.reject("AUTH_ERROR", cause?.message ?: "Google authorization failed.", cause)
            return@addOnCompleteListener
          }
          val result = task.result
          if (!result.accessToken.isNullOrEmpty()) {
            promise.resolve(authorizationPayload(result))
            return@addOnCompleteListener
          }
          val pendingIntent = result.pendingIntent
          if (pendingIntent == null) {
            promise.reject("AUTH_EMPTY", "Google returned no access token and no resolution.", null)
            return@addOnCompleteListener
          }
          if (!interactive) {
            promise.reject("AUTH_REQUIRED", "Google authorization requires user interaction.", null)
            return@addOnCompleteListener
          }
          val activity: Activity = appContext.currentActivity
            ?: run {
              promise.reject("NO_ACTIVITY", "No foreground activity to present the Google authorization UI.", null)
              return@addOnCompleteListener
            }
          pendingAuthorization = promise
          activity.startIntentSenderForResult(pendingIntent.intentSender, REQUEST_CODE, null, 0, 0, 0)
        }
      } catch (error: Exception) {
        promise.reject("AUTH_ERROR", error.message ?: "Google authorization failed.", error)
      }
    }
  }

  private fun authorizationPayload(result: AuthorizationResult): Map<String, Any> {
    return mapOf(
      "accessToken" to (result.accessToken ?: ""),
      "grantedScopes" to result.grantedScopes,
    )
  }

  companion object {
    private const val REQUEST_CODE = 7101
  }
}
