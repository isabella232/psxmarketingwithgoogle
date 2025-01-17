/**
 * 2007-2021 PrestaShop and Contributors
 *
 * NOTICE OF LICENSE
 *
 * This source file is subject to the Academic Free License 3.0 (AFL-3.0)
 * that is bundled with this package in the file LICENSE.txt.
 * It is also available through the world-wide-web at this URL:
 * https://opensource.org/licenses/AFL-3.0
 * If you did not receive a copy of the license and are unable to
 * obtain it through the world-wide-web, please send an email
 * to license@prestashop.com so we can send you a copy immediately.
 *
 * @author    PrestaShop SA <contact@prestashop.com>
 * @copyright 2007-2021 PrestaShop SA and Contributors
 * @license   https://opensource.org/licenses/AFL-3.0 Academic Free License 3.0 (AFL-3.0)
 * International Registered Trademark & Property of PrestaShop SA
 */

import {fetchOnboarding, fetchShop, HttpClientError} from 'mktg-with-google-common';
import {WebsiteClaimErrorReason} from '@/store/modules/accounts/state';
import MutationsTypes from './mutations-types';
import MutationsTypesProductFeed from '../product-feed/mutations-types';
import MutationsTypesGoogleAds from '../google-ads/mutations-types';
import ActionsTypes from './actions-types';
import NeedOverwriteError from '../../../utils/NeedOverwriteError';
import CannotOverwriteError from '../../../utils/CannotOverwriteError';

export default {
  async [ActionsTypes.WARMUP_STORE](
    {dispatch, state},
  ) {
    if (state.warmedUp) {
      return;
    }
    state.warmedUp = true;

    await dispatch(ActionsTypes.REQUEST_GOOGLE_ACCOUNT_DETAILS);
  },

  async [ActionsTypes.SAVE_SELECTED_GOOGLE_MERCHANT_ACCOUNT](
    {
      commit,
      dispatch,
    },
    payload,
  ) {
    const {selectedAccount, correlationId} = payload;
    const aggregator = selectedAccount.aggregatorId ? `?aggregator_id=${selectedAccount.aggregatorId}` : '';
    const route = `merchant-accounts/${selectedAccount.id}/link${aggregator}`;

    await fetchOnboarding(
      'POST',
      route,
      {
        correlationId,
        onResponse: async (response) => {
          if (!response.ok) {
            commit(
              MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
              WebsiteClaimErrorReason.LinkingFailed,
            );
            throw new HttpClientError(response.statusText, response.status);
          }
        },
      },
    );

    dispatch(ActionsTypes.SEND_GMC_INFORMATION_TO_SHOP, {
      id: selectedAccount.id,
    });
    commit(MutationsTypes.SAVE_GMC, selectedAccount);
  },

  async [ActionsTypes.TRIGGER_WEBSITE_VERIFICATION_AND_CLAIMING_PROCESS](
    {
      commit,
      dispatch,
      state,
      rootState,
    },
    correlationId: string,
  ) {
    commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING, WebsiteClaimErrorReason.PendingCheck);
    try {
      let {isVerified, isClaimed} = await dispatch(
        ActionsTypes.REQUEST_WEBSITE_CLAIMING_STATUS,
        correlationId,
      );

      const {token} = await dispatch(ActionsTypes.REQUEST_SITE_VERIFICATION_TOKEN, correlationId);
      dispatch(ActionsTypes.SAVE_WEBSITE_VERIFICATION_META, token);

      if (!isVerified || !isClaimed) {
        if (rootState.app.psxMktgWithGoogleModuleIsEnabled === false) {
          commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING, null);
          return;
        }
        const result = await dispatch(
          ActionsTypes.TRIGGER_WEBSITE_VERIFICATION_PROCESS,
          correlationId,
        );
        isVerified = result.isVerified;
        isClaimed = result.isClaimed;

        if (!result.isVerified) {
          return;
        }

        await dispatch(
          ActionsTypes.TRIGGER_WEBSITE_CLAIMING_PROCESS,
          {overwrite: false, correlationId},
        );
      } else if (state.googleMerchantAccount.isSuspended.status) {
        commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING, null);
      } else if (state.googleMerchantAccount.isPhoneVerified.status === false) {
        commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
          WebsiteClaimErrorReason.PhoneVerificationNeeded);
      } else {
        commit(MutationsTypes.SAVE_MCA_CONNECTED_ONCE, true);
        commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING, null);
      }
    } catch (error) {
      if (error instanceof NeedOverwriteError) {
        commit(
          MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
          WebsiteClaimErrorReason.OverwriteNeeded,
        );
      } else {
        commit(
          MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
          WebsiteClaimErrorReason.AccountValidationFailed,
        );
      }
    }
  },

  async [ActionsTypes.REQUEST_ROUTE_TO_GOOGLE_AUTH]({commit, state, rootState}) {
    const urlState = btoa(JSON.stringify({
      redirectUri: rootState.app.psxMktgWithGoogleAdminUrl,
      shopId: state.shopIdPsAccounts,
      shopUrl: rootState.app.psxMktgWithGoogleShopUrl,
    }));
    try {
      const json = await (await fetchOnboarding(
        'GET',
        `oauth/authorized-url?state=${urlState}`,
      )).json();

      commit(MutationsTypes.SET_GOOGLE_AUTHENTICATION_URL, json.authorizedUrl);
    } catch (error) {
      console.error(`Could not request route to google auth: ${(<any>error)?.message}`);
      commit(MutationsTypes.SET_GOOGLE_AUTHENTICATION_URL, error);
    }
  },

  async [ActionsTypes.REQUEST_GOOGLE_ACCOUNT_DETAILS]({
    commit, dispatch,
  }) {
    try {
      const json = await (await fetchOnboarding('GET', 'oauth')).json();

      commit(MutationsTypes.SAVE_GOOGLE_ACCOUNT_TOKEN, json);
      commit(MutationsTypes.SET_GOOGLE_ACCOUNT, json);
      if (json.account_id) {
        commit(MutationsTypes.SAVE_GMC, {
          id: json.account_id,
        });
      }
      if (json.google_ads_account_id) {
        commit(`googleAds/${MutationsTypesGoogleAds.SET_GOOGLE_ADS_ACCOUNT_ID}`, json.google_ads_account_id, {root: true},
        );
      }
      // If GMC is already linked, must start by requesting GMC list, then look after the link GMC.
      // Also needed if we didn't have linked the accounts yet, as the marchant has to pick one.
      dispatch(ActionsTypes.REQUEST_GMC_LIST);
      return json;
    } catch (error) {
      dispatch(ActionsTypes.REQUEST_ROUTE_TO_GOOGLE_AUTH);
      if (error instanceof HttpClientError && (error.code === 404 || error.code === 412)) {
        // This is likely caused by a missing Google account, so let's retrieve the URL
        return null;
      }
      console.error(`Could not request google account details: ${(<any>error)?.message}`);
      commit(MutationsTypes.SAVE_GOOGLE_ACCOUNT_TOKEN, error);
    }
    return null;
  },

  async [ActionsTypes.REQUEST_GMC_LIST]({
    commit, state, dispatch,
  }) {
    try {
      const json = await (await fetchOnboarding(
        'GET',
        'merchant-accounts',
      )).json();
      commit(MutationsTypes.SAVE_GMC_LIST, json);

      // Now we have the GMC merchant's list, if he already linked one, then must fill it now
      if (state.googleMerchantAccount.id) {
        const linkedGmc = json.find((gmc) => gmc.id === state.googleMerchantAccount.id);

        if (linkedGmc) {
          commit(MutationsTypes.SAVE_GMC, linkedGmc);
          dispatch(ActionsTypes.TRIGGER_WEBSITE_VERIFICATION_AND_CLAIMING_PROCESS);
        } else {
          // Cannot find linked GMC. Maybe it's a freshly created one, in this case previous HTTP
          //  call has failed. Then try another way...
          dispatch(ActionsTypes.REQUEST_NEW_GMC_DETAILS);
        }
      }
    } catch (error) {
      commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING, WebsiteClaimErrorReason.LinkingFailed);
      console.error(`Could not request GMC list: ${(<any>error)?.message}`);
    }
  },

  async [ActionsTypes.DISSOCIATE_GOOGLE_ACCOUNT]({
    commit, rootState, state, dispatch,
  }) {
    const correlationId = `${state.shopIdPsAccounts}-${Math.floor(Date.now() / 1000)}`;
    await fetchOnboarding('DELETE', 'oauth', {correlationId});

    commit(MutationsTypes.REMOVE_GMC);
    commit(MutationsTypes.SAVE_MCA_CONNECTED_ONCE, false);
    commit(`productFeed/${MutationsTypesProductFeed.TOGGLE_CONFIGURATION_FINISHED}`, false, {root: true});
    commit(MutationsTypes.REMOVE_GOOGLE_ACCOUNT);
    commit(MutationsTypes.SET_GOOGLE_ACCOUNT, null);
    dispatch(ActionsTypes.REQUEST_ROUTE_TO_GOOGLE_AUTH);
    return true;
  },

  async [ActionsTypes.DISSOCIATE_GMC]({
    commit,
    state,
    dispatch,
  }, correlationId: string) {
    if (state.googleMerchantAccount.id) {
      if (!correlationId) {
        // eslint-disable-next-line no-param-reassign
        correlationId = `${state.shopIdPsAccounts}-${Math.floor(Date.now() / 1000)}`;
      }
      await fetchOnboarding(
        'DELETE',
        'merchant-accounts',
        {
          correlationId,
          onResponse: async (response) => {
            if (!response.ok) {
              commit(
                MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
                WebsiteClaimErrorReason.UnlinkFailed,
              );
              throw new HttpClientError(response.statusText, response.status);
            }
          },
        },
      );
    }
    dispatch(ActionsTypes.SAVE_WEBSITE_VERIFICATION_META, false);
    commit(MutationsTypes.REMOVE_GMC);
    commit(MutationsTypes.SAVE_MCA_CONNECTED_ONCE, false);
    commit(`googleAds/${MutationsTypesGoogleAds.SET_GOOGLE_ADS_ACCOUNT}`, '', {root: true});
    commit(`productFeed/${MutationsTypesProductFeed.REMOVE_PRODUCT_FEED}`, null, {root: true});
    commit(`productFeed/${MutationsTypesProductFeed.SET_ACTIVE_CONFIGURATION_STEP}`, 1, {root: true});
    commit(`productFeed/${MutationsTypesProductFeed.TOGGLE_CONFIGURATION_FINISHED}`, false, {root: true});
    return true;
  },

  async [ActionsTypes.REQUEST_TO_OVERRIDE_CLAIM]({commit, dispatch}) {
    try {
      await dispatch(
        ActionsTypes.TRIGGER_WEBSITE_CLAIMING_PROCESS,
        {overwrite: true},
      );
      commit(MutationsTypes.SAVE_WEBSITE_CLAIMING_STATUS, false);
      setTimeout(() => {
        commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING, null);
        commit(MutationsTypes.SAVE_WEBSITE_CLAIMING_STATUS, true);
      }, 2000);
      commit(MutationsTypes.SAVE_MCA_CONNECTED_ONCE, true);
    } catch (error) {
      if (error instanceof CannotOverwriteError) {
        commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
          WebsiteClaimErrorReason.OverwriteNeededWithManualAction);
      } else {
        commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
          WebsiteClaimErrorReason.AccountValidationFailed);
      }
    }
    return true;
  },

  /** Merchant Center Account - Website verification */
  async [ActionsTypes.TRIGGER_WEBSITE_VERIFICATION_PROCESS]({dispatch, state}) {
    const correlationId = `${state.shopIdPsAccounts}-${Math.floor(Date.now() / 1000)}`;
    try {
      // 1- Get site verification token from onboarding API
      const {token} = await dispatch(ActionsTypes.REQUEST_SITE_VERIFICATION_TOKEN, correlationId);
      // 2- Store token in shop
      await dispatch(ActionsTypes.SAVE_WEBSITE_VERIFICATION_META, token);
      // 3- Request verification to Google via onboarding API
      await dispatch(ActionsTypes.REQUEST_GOOGLE_TO_VERIFY_WEBSITE, correlationId);
      // 4- Retrieve verification results
      const {isVerified, isClaimed} = await dispatch(
        ActionsTypes.REQUEST_WEBSITE_CLAIMING_STATUS,
        correlationId,
      );

      if (!isVerified) {
        throw new Error('Website was not verified by Google');
      }
      return {isVerified, isClaimed};
    } catch (error) {
      console.error(`Could not trigger website verification process: ${(<any>error)?.message}`);
      throw error;
    }
  },

  // eslint-disable-next-line no-empty-pattern
  async [ActionsTypes.REQUEST_SITE_VERIFICATION_TOKEN]({}, correlationId: string) {
    return (await fetchOnboarding(
      'GET',
      'shopping-websites/site-verification/token',
      {correlationId},
    )).json();
  },

  // eslint-disable-next-line no-empty-pattern
  async [ActionsTypes.SAVE_WEBSITE_VERIFICATION_META]({}, token: string|false) {
    return fetchShop('setWebsiteVerificationMeta', {websiteVerificationMeta: token});
  },

  // eslint-disable-next-line no-empty-pattern
  async [ActionsTypes.REQUEST_GOOGLE_TO_VERIFY_WEBSITE]({}, correlationId: string) {
    return (await fetchOnboarding(
      'POST',
      'shopping-websites/site-verification/verify',
      {correlationId},
    )).json();
  },

  async [ActionsTypes.REQUEST_WEBSITE_CLAIMING_STATUS](
    {
      commit,
    },
    correlationId: string,
  ) {
    const json = await (await fetchOnboarding(
      'GET',
      'shopping-websites/site-verification/status',
      {correlationId},
    )).json();

    commit(MutationsTypes.SAVE_WEBSITE_VERIFICATION_AND_CLAIMING_STATUS, json);
    return json;
  },

  async [ActionsTypes.TRIGGER_WEBSITE_CLAIMING_PROCESS](
    {commit},
    payload,
  ) {
    const {overwrite, correlationId} = payload;
    const overwriteParam = `?overwrite=${overwrite ? 'true' : 'false'}`;
    const url = `shopping-websites/site-verification/claim${overwriteParam}`;
    const json = await fetchOnboarding(
      'POST',
      url,
      {
        correlationId,
        onResponse: async (response: Response) => {
          if (!response.ok) {
            const error = await response.json();

            if (error.fromGoogle?.needOverwrite) {
              throw new NeedOverwriteError(error, error.fromGoogle.error.code);
            }
            if (error.fromGoogle?.cannotOverwrite) {
              throw new CannotOverwriteError(error, error.fromGoogle.error.code);
            }
            throw new HttpClientError(response.statusText, response.status);
          }
          return response.json();
        },
      },
    );

    commit(MutationsTypes.SAVE_WEBSITE_CLAIMING_STATUS, true);
    commit(MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING, null);
    return json;
  },

  // eslint-disable-next-line no-empty-pattern
  async [ActionsTypes.SEND_WEBSITE_REQUIREMENTS]({}, payload: Array<String>) {
    return fetchShop('setWebsiteRequirementStatus', {requirements: payload});
  },

  async [ActionsTypes.REQUEST_WEBSITE_REQUIREMENTS]({commit}) {
    try {
      const json = await fetchShop('getWebsiteRequirementStatus');

      commit(MutationsTypes.SAVE_WEBSITE_REQUIREMENTS, json);
    } catch (error) {
      console.error(`Could not request website requirements: ${(<any>error)?.message}`);
    }
  },

  async [ActionsTypes.REQUEST_SHOP_INFORMATIONS]({rootState, commit}) {
    try {
      const json = await fetchShop('getShopConfigurationForGMC');
      commit(MutationsTypes.SAVE_SHOP_INFORMATIONS, json);
    } catch (error) {
      console.error(`Could not request shop information: ${(<any>error)?.message}`);
    }
  },

  async [ActionsTypes.REQUEST_TO_SAVE_NEW_GMC]({
    rootState, dispatch, commit,
  }, payload) {
    try {
      const json = await (await fetchOnboarding(
        'POST',
        'merchant-accounts/',
        {body: payload},
      )).json();

      const accountId = json.account_id;
      const newGmc = {
        aggregatorId: json.aggregator_id,
        kind: 'content#account',
        id: accountId,
        name: payload.shop_name,
        websiteUrl: payload.shop_url,
        adultContent: payload.adult_content,
        users: [
          {
            emailAddress: rootState.accounts.googleAccount.details.email,
            admin: true,
          },
        ],
        businessInformation: {
          address: {
            country: payload.location,
          },
        },
        subAccountNotManagedByPrestashop: false,
      };

      commit(MutationsTypes.ADD_NEW_GMC, newGmc);
      commit(MutationsTypes.SAVE_GMC, newGmc);
      dispatch(ActionsTypes.SEND_GMC_INFORMATION_TO_SHOP, {
        id: accountId,
      });

      commit(
        MutationsTypes.SAVE_STATUS_OVERRIDE_CLAIMING,
        WebsiteClaimErrorReason.PhoneVerificationNeeded,
      );
    } catch (error) {
      console.error(error);
    }
  },

  async [ActionsTypes.REQUEST_NEW_GMC_DETAILS]({
    commit, rootState, state, dispatch,
  }) {
    try {
      const linkedGmc = await (await fetchOnboarding(
        'GET',
        `merchant-accounts/${state.googleMerchantAccount.id}`,
      )).json();

      if (linkedGmc) {
        commit(MutationsTypes.SAVE_GMC, linkedGmc);
        dispatch(ActionsTypes.SEND_GMC_INFORMATION_TO_SHOP, {
          id: rootState.accounts.googleMerchantAccount.id,
        });
        dispatch(ActionsTypes.TRIGGER_WEBSITE_VERIFICATION_AND_CLAIMING_PROCESS);
      } else {
        throw new Error('Failed to find GMC!');
      }
    } catch (error) {
      console.error(error);
      console.log(`GMC ${state.googleMerchantAccount.id} not found, try to search again in 15s`);
      setTimeout(() => dispatch(ActionsTypes.REQUEST_GMC_LIST), 15000);
    }
    return null;
  },

  // eslint-disable-next-line no-empty-pattern
  async [ActionsTypes.REQUEST_VERIFICATION_CODE]({}, payload) {
    return (await fetchOnboarding(
      'POST',
      'merchant-accounts/phone-verification/request-code',
      {body: payload},
    )).json();
  },

  // eslint-disable-next-line no-empty-pattern
  async [ActionsTypes.SEND_VERIFICATION_CODE]({}, payload) {
    return (await fetchOnboarding(
      'POST',
      'merchant-accounts/phone-verification/verify',
      {body: payload},
    )).json();
  },

  // eslint-disable-next-line no-empty-pattern
  async [ActionsTypes.SEND_GMC_INFORMATION_TO_SHOP]({}, gmcInfo) {
    try {
      await fetchShop('setGMCInformations', {gmcInformations: gmcInfo});
    } catch (error) {
      console.error(error);
    }
  },
};
