/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Token map key for the signed-in user's Arni API session. The search provider key never leaves the API. */
export const ARNI_API_RESOURCE = 'https://api.arnion.ru';

/** Origins tried in order. The Russian proxy is first; Vercel is the direct fallback. */
export const ARNI_API_ORIGINS = ['https://api.arnion.ru', 'https://arni-backend.vercel.app'] as const;
