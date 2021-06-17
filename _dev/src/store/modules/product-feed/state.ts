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

// ToDo: Replace every "any" in this file with the proper type
export interface ProductFeedStatus {
  nextJobAt?: string,
  jobEndedAt?: string;
  shopHealthy: boolean;
  failedSyncs: Array<string>;
  successfulSyncs: Array<string>;
  enabled: boolean;
}
export interface ProductFeedSettingsSellingApparel {
  customColorAttribute?: string;
  customSizeAttribute?: string;
  customAgeGroupAttribute?: string;
  customGenderGroupAttribute?: string;
}

export interface ProductFeedSettingsSellingRefurbished {
  customConditionAttribute?: string;
}

export interface ProductFeedSettings {
  autoImportTaxSettings: boolean;
  targetCountries: Array<string>;
  autoImportShippingSettings: boolean;
  exportProductsWithShortDescription: boolean;
  sellApparel: ProductFeedSettingsSellingApparel;
  sellRefurbished: ProductFeedSettingsSellingRefurbished,
}

export interface State {
  productFeed: {
    isConfigured: boolean,
    stepper: number,
    status: ProductFeedStatus,
    settings: ProductFeedSettings,
  },
}

export const state: State = {
  productFeed: {
    isConfigured: false,
    stepper: 1,
    status: {
      failedSyncs: [],
      successfulSyncs: [],
      enabled: false,
      shopHealthy: true,
    },
    settings: {
      autoImportTaxSettings: false,
      targetCountries: [],
      autoImportShippingSettings: false,
      exportProductsWithShortDescription: true,
      sellApparel: {
        customColorAttribute: 'extra:color',
        customSizeAttribute: 'extra:size',
        customAgeGroupAttribute: 'extra:age-group',
        customGenderGroupAttribute: 'extra:gender-group',
      },
      sellRefurbished: {
        customConditionAttribute: 'extra:condition',
      },
    },
  },
};
