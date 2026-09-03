/* ISO 4217 currencies.
   [code, dropdown name, word used in "Amount ( In Words )", subunit, decimals]
   `major` is spelled the way it should read in the words line ("US Dollars"),
   `minor` is null for currencies with no subunit (JPY, KRW, …). */
(function (root) {
  'use strict';

  var RAW = [
    ['ZMW', 'ZMW — Zambian Kwacha', 'Zambian Kwacha', 'Ngwee', 2],
    ['USD', 'USD — US Dollar', 'US Dollars', 'Cents', 2],

    ['AED', 'AED — UAE Dirham', 'UAE Dirhams', 'Fils', 2],
    ['AFN', 'AFN — Afghan Afghani', 'Afghan Afghani', 'Pul', 2],
    ['ALL', 'ALL — Albanian Lek', 'Albanian Lek', 'Qindarka', 2],
    ['AMD', 'AMD — Armenian Dram', 'Armenian Dram', 'Luma', 2],
    ['ANG', 'ANG — Netherlands Antillean Guilder', 'Guilders', 'Cents', 2],
    ['AOA', 'AOA — Angolan Kwanza', 'Angolan Kwanza', 'Centimos', 2],
    ['ARS', 'ARS — Argentine Peso', 'Argentine Pesos', 'Centavos', 2],
    ['AUD', 'AUD — Australian Dollar', 'Australian Dollars', 'Cents', 2],
    ['AWG', 'AWG — Aruban Florin', 'Aruban Florins', 'Cents', 2],
    ['AZN', 'AZN — Azerbaijani Manat', 'Azerbaijani Manat', 'Qepik', 2],
    ['BAM', 'BAM — Bosnia-Herzegovina Convertible Mark', 'Convertible Marks', 'Fening', 2],
    ['BBD', 'BBD — Barbadian Dollar', 'Barbadian Dollars', 'Cents', 2],
    ['BDT', 'BDT — Bangladeshi Taka', 'Bangladeshi Taka', 'Poisha', 2],
    ['BGN', 'BGN — Bulgarian Lev', 'Bulgarian Leva', 'Stotinki', 2],
    ['BHD', 'BHD — Bahraini Dinar', 'Bahraini Dinars', 'Fils', 3],
    ['BIF', 'BIF — Burundian Franc', 'Burundian Francs', null, 0],
    ['BMD', 'BMD — Bermudian Dollar', 'Bermudian Dollars', 'Cents', 2],
    ['BND', 'BND — Brunei Dollar', 'Brunei Dollars', 'Cents', 2],
    ['BOB', 'BOB — Bolivian Boliviano', 'Bolivianos', 'Centavos', 2],
    ['BRL', 'BRL — Brazilian Real', 'Brazilian Reais', 'Centavos', 2],
    ['BSD', 'BSD — Bahamian Dollar', 'Bahamian Dollars', 'Cents', 2],
    ['BTN', 'BTN — Bhutanese Ngultrum', 'Ngultrum', 'Chhertum', 2],
    ['BWP', 'BWP — Botswanan Pula', 'Botswana Pula', 'Thebe', 2],
    ['BYN', 'BYN — Belarusian Ruble', 'Belarusian Rubles', 'Kopecks', 2],
    ['BZD', 'BZD — Belize Dollar', 'Belize Dollars', 'Cents', 2],
    ['CAD', 'CAD — Canadian Dollar', 'Canadian Dollars', 'Cents', 2],
    ['CDF', 'CDF — Congolese Franc', 'Congolese Francs', 'Centimes', 2],
    ['CHF', 'CHF — Swiss Franc', 'Swiss Francs', 'Rappen', 2],
    ['CLP', 'CLP — Chilean Peso', 'Chilean Pesos', null, 0],
    ['CNY', 'CNY — Chinese Yuan', 'Chinese Yuan', 'Fen', 2],
    ['COP', 'COP — Colombian Peso', 'Colombian Pesos', 'Centavos', 2],
    ['CRC', 'CRC — Costa Rican Colon', 'Costa Rican Colones', 'Centimos', 2],
    ['CUP', 'CUP — Cuban Peso', 'Cuban Pesos', 'Centavos', 2],
    ['CVE', 'CVE — Cape Verdean Escudo', 'Cape Verdean Escudos', 'Centavos', 2],
    ['CZK', 'CZK — Czech Koruna', 'Czech Koruna', 'Haler', 2],
    ['DJF', 'DJF — Djiboutian Franc', 'Djiboutian Francs', null, 0],
    ['DKK', 'DKK — Danish Krone', 'Danish Kroner', 'Ore', 2],
    ['DOP', 'DOP — Dominican Peso', 'Dominican Pesos', 'Centavos', 2],
    ['DZD', 'DZD — Algerian Dinar', 'Algerian Dinars', 'Centimes', 2],
    ['EGP', 'EGP — Egyptian Pound', 'Egyptian Pounds', 'Piastres', 2],
    ['ERN', 'ERN — Eritrean Nakfa', 'Eritrean Nakfa', 'Cents', 2],
    ['ETB', 'ETB — Ethiopian Birr', 'Ethiopian Birr', 'Santim', 2],
    ['EUR', 'EUR — Euro', 'Euros', 'Cents', 2],
    ['FJD', 'FJD — Fijian Dollar', 'Fijian Dollars', 'Cents', 2],
    ['GBP', 'GBP — British Pound', 'British Pounds', 'Pence', 2],
    ['GEL', 'GEL — Georgian Lari', 'Georgian Lari', 'Tetri', 2],
    ['GHS', 'GHS — Ghanaian Cedi', 'Ghanaian Cedis', 'Pesewas', 2],
    ['GMD', 'GMD — Gambian Dalasi', 'Gambian Dalasi', 'Bututs', 2],
    ['GNF', 'GNF — Guinean Franc', 'Guinean Francs', null, 0],
    ['GTQ', 'GTQ — Guatemalan Quetzal', 'Guatemalan Quetzales', 'Centavos', 2],
    ['GYD', 'GYD — Guyanaese Dollar', 'Guyanese Dollars', 'Cents', 2],
    ['HKD', 'HKD — Hong Kong Dollar', 'Hong Kong Dollars', 'Cents', 2],
    ['HNL', 'HNL — Honduran Lempira', 'Honduran Lempiras', 'Centavos', 2],
    ['HTG', 'HTG — Haitian Gourde', 'Haitian Gourdes', 'Centimes', 2],
    ['HUF', 'HUF — Hungarian Forint', 'Hungarian Forint', 'Filler', 2],
    ['IDR', 'IDR — Indonesian Rupiah', 'Indonesian Rupiah', 'Sen', 2],
    ['ILS', 'ILS — Israeli New Shekel', 'Israeli New Shekels', 'Agorot', 2],
    ['INR', 'INR — Indian Rupee', 'Indian Rupees', 'Paise', 2],
    ['IQD', 'IQD — Iraqi Dinar', 'Iraqi Dinars', 'Fils', 3],
    ['IRR', 'IRR — Iranian Rial', 'Iranian Rials', 'Dinars', 2],
    ['ISK', 'ISK — Icelandic Krona', 'Icelandic Kronur', null, 0],
    ['JMD', 'JMD — Jamaican Dollar', 'Jamaican Dollars', 'Cents', 2],
    ['JOD', 'JOD — Jordanian Dinar', 'Jordanian Dinars', 'Fils', 3],
    ['JPY', 'JPY — Japanese Yen', 'Japanese Yen', null, 0],
    ['KES', 'KES — Kenyan Shilling', 'Kenyan Shillings', 'Cents', 2],
    ['KGS', 'KGS — Kyrgystani Som', 'Kyrgyzstani Som', 'Tyiyn', 2],
    ['KHR', 'KHR — Cambodian Riel', 'Cambodian Riels', 'Sen', 2],
    ['KMF', 'KMF — Comorian Franc', 'Comorian Francs', null, 0],
    ['KRW', 'KRW — South Korean Won', 'South Korean Won', null, 0],
    ['KWD', 'KWD — Kuwaiti Dinar', 'Kuwaiti Dinars', 'Fils', 3],
    ['KYD', 'KYD — Cayman Islands Dollar', 'Cayman Islands Dollars', 'Cents', 2],
    ['KZT', 'KZT — Kazakhstani Tenge', 'Kazakhstani Tenge', 'Tiyn', 2],
    ['LAK', 'LAK — Laotian Kip', 'Lao Kip', 'Att', 2],
    ['LBP', 'LBP — Lebanese Pound', 'Lebanese Pounds', 'Piastres', 2],
    ['LKR', 'LKR — Sri Lankan Rupee', 'Sri Lankan Rupees', 'Cents', 2],
    ['LRD', 'LRD — Liberian Dollar', 'Liberian Dollars', 'Cents', 2],
    ['LSL', 'LSL — Lesotho Loti', 'Lesotho Maloti', 'Lisente', 2],
    ['LYD', 'LYD — Libyan Dinar', 'Libyan Dinars', 'Dirhams', 3],
    ['MAD', 'MAD — Moroccan Dirham', 'Moroccan Dirhams', 'Centimes', 2],
    ['MDL', 'MDL — Moldovan Leu', 'Moldovan Lei', 'Bani', 2],
    ['MGA', 'MGA — Malagasy Ariary', 'Malagasy Ariary', 'Iraimbilanja', 2],
    ['MKD', 'MKD — Macedonian Denar', 'Macedonian Denari', 'Deni', 2],
    ['MMK', 'MMK — Myanmar Kyat', 'Myanmar Kyats', 'Pyas', 2],
    ['MNT', 'MNT — Mongolian Tugrik', 'Mongolian Tugriks', 'Mongo', 2],
    ['MOP', 'MOP — Macanese Pataca', 'Macanese Patacas', 'Avos', 2],
    ['MRU', 'MRU — Mauritanian Ouguiya', 'Mauritanian Ouguiya', 'Khoums', 2],
    ['MUR', 'MUR — Mauritian Rupee', 'Mauritian Rupees', 'Cents', 2],
    ['MVR', 'MVR — Maldivian Rufiyaa', 'Maldivian Rufiyaa', 'Laari', 2],
    ['MWK', 'MWK — Malawian Kwacha', 'Malawian Kwacha', 'Tambala', 2],
    ['MXN', 'MXN — Mexican Peso', 'Mexican Pesos', 'Centavos', 2],
    ['MYR', 'MYR — Malaysian Ringgit', 'Malaysian Ringgit', 'Sen', 2],
    ['MZN', 'MZN — Mozambican Metical', 'Mozambican Meticais', 'Centavos', 2],
    ['NAD', 'NAD — Namibian Dollar', 'Namibian Dollars', 'Cents', 2],
    ['NGN', 'NGN — Nigerian Naira', 'Nigerian Naira', 'Kobo', 2],
    ['NIO', 'NIO — Nicaraguan Cordoba', 'Nicaraguan Cordobas', 'Centavos', 2],
    ['NOK', 'NOK — Norwegian Krone', 'Norwegian Kroner', 'Ore', 2],
    ['NPR', 'NPR — Nepalese Rupee', 'Nepalese Rupees', 'Paisa', 2],
    ['NZD', 'NZD — New Zealand Dollar', 'New Zealand Dollars', 'Cents', 2],
    ['OMR', 'OMR — Omani Rial', 'Omani Rials', 'Baisa', 3],
    ['PAB', 'PAB — Panamanian Balboa', 'Panamanian Balboas', 'Centesimos', 2],
    ['PEN', 'PEN — Peruvian Sol', 'Peruvian Soles', 'Centimos', 2],
    ['PGK', 'PGK — Papua New Guinean Kina', 'Papua New Guinean Kina', 'Toea', 2],
    ['PHP', 'PHP — Philippine Peso', 'Philippine Pesos', 'Centavos', 2],
    ['PKR', 'PKR — Pakistani Rupee', 'Pakistani Rupees', 'Paisa', 2],
    ['PLN', 'PLN — Polish Zloty', 'Polish Zloty', 'Groszy', 2],
    ['PYG', 'PYG — Paraguayan Guarani', 'Paraguayan Guarani', null, 0],
    ['QAR', 'QAR — Qatari Rial', 'Qatari Rials', 'Dirhams', 2],
    ['RON', 'RON — Romanian Leu', 'Romanian Lei', 'Bani', 2],
    ['RSD', 'RSD — Serbian Dinar', 'Serbian Dinars', 'Para', 2],
    ['RUB', 'RUB — Russian Ruble', 'Russian Rubles', 'Kopecks', 2],
    ['RWF', 'RWF — Rwandan Franc', 'Rwandan Francs', null, 0],
    ['SAR', 'SAR — Saudi Riyal', 'Saudi Riyals', 'Halalas', 2],
    ['SBD', 'SBD — Solomon Islands Dollar', 'Solomon Islands Dollars', 'Cents', 2],
    ['SCR', 'SCR — Seychellois Rupee', 'Seychellois Rupees', 'Cents', 2],
    ['SDG', 'SDG — Sudanese Pound', 'Sudanese Pounds', 'Piastres', 2],
    ['SEK', 'SEK — Swedish Krona', 'Swedish Kronor', 'Ore', 2],
    ['SGD', 'SGD — Singapore Dollar', 'Singapore Dollars', 'Cents', 2],
    ['SLE', 'SLE — Sierra Leonean Leone', 'Sierra Leonean Leones', 'Cents', 2],
    ['SOS', 'SOS — Somali Shilling', 'Somali Shillings', 'Cents', 2],
    ['SRD', 'SRD — Surinamese Dollar', 'Surinamese Dollars', 'Cents', 2],
    ['SSP', 'SSP — South Sudanese Pound', 'South Sudanese Pounds', 'Piastres', 2],
    ['SZL', 'SZL — Swazi Lilangeni', 'Swazi Emalangeni', 'Cents', 2],
    ['THB', 'THB — Thai Baht', 'Thai Baht', 'Satang', 2],
    ['TJS', 'TJS — Tajikistani Somoni', 'Tajikistani Somoni', 'Diram', 2],
    ['TMT', 'TMT — Turkmenistani Manat', 'Turkmenistani Manat', 'Tenge', 2],
    ['TND', 'TND — Tunisian Dinar', 'Tunisian Dinars', 'Millimes', 3],
    ['TOP', 'TOP — Tongan Paanga', 'Tongan Paanga', 'Seniti', 2],
    ['TRY', 'TRY — Turkish Lira', 'Turkish Lira', 'Kurus', 2],
    ['TTD', 'TTD — Trinidad & Tobago Dollar', 'Trinidad and Tobago Dollars', 'Cents', 2],
    ['TWD', 'TWD — New Taiwan Dollar', 'New Taiwan Dollars', 'Cents', 2],
    ['TZS', 'TZS — Tanzanian Shilling', 'Tanzanian Shillings', 'Cents', 2],
    ['UAH', 'UAH — Ukrainian Hryvnia', 'Ukrainian Hryvnia', 'Kopiyka', 2],
    ['UGX', 'UGX — Ugandan Shilling', 'Ugandan Shillings', null, 0],
    ['UYU', 'UYU — Uruguayan Peso', 'Uruguayan Pesos', 'Centesimos', 2],
    ['UZS', 'UZS — Uzbekistani Som', 'Uzbekistani Som', 'Tiyin', 2],
    ['VES', 'VES — Venezuelan Bolivar', 'Venezuelan Bolivares', 'Centimos', 2],
    ['VND', 'VND — Vietnamese Dong', 'Vietnamese Dong', null, 0],
    ['VUV', 'VUV — Vanuatu Vatu', 'Vanuatu Vatu', null, 0],
    ['WST', 'WST — Samoan Tala', 'Samoan Tala', 'Sene', 2],
    ['XAF', 'XAF — Central African CFA Franc', 'CFA Francs', null, 0],
    ['XCD', 'XCD — East Caribbean Dollar', 'East Caribbean Dollars', 'Cents', 2],
    ['XOF', 'XOF — West African CFA Franc', 'CFA Francs', null, 0],
    ['XPF', 'XPF — CFP Franc', 'CFP Francs', null, 0],
    ['YER', 'YER — Yemeni Rial', 'Yemeni Rials', 'Fils', 2],
    ['ZAR', 'ZAR — South African Rand', 'South African Rand', 'Cents', 2],
    ['ZWG', 'ZWG — Zimbabwe Gold', 'Zimbabwe Gold', 'Cents', 2]
  ];

  /* ZMW and USD stay at the head of the list — they are the two this agency
     actually bills in, and the app renders them bold in the dropdown. */
  var PINNED = ['ZMW', 'USD'];

  /* Currencies whose home country groups digits the Indian way (2,2,3):
     1240000.50 reads 12,40,000.50, not 1,240,000.50.

     This list is exactly what CLDR reports for each currency's primary
     locale — checked one at a time, not assumed from geography. Two that
     look like they belong here do not: Pakistan reads 1,240,000.50 in all
     four of its locales (en/ur/pa/sd-PK), and Sri Lanka's primary si-LK
     does the same. Every other currency on earth groups by threes. */
  var GROUP_INDIAN = ['INR', 'BDT', 'NPR', 'BTN'];

  var CURRENCIES = {};
  var ORDER = [];
  RAW.forEach(function (r) {
    CURRENCIES[r[0]] = {
      code: r[0], name: r[1], major: r[2], minor: r[3],
      decimals: r[4], pinned: PINNED.indexOf(r[0]) >= 0,
      group: GROUP_INDIAN.indexOf(r[0]) >= 0 ? 'in' : 'std'
    };
    ORDER.push(r[0]);
  });

  var api = { map: CURRENCIES, order: ORDER, pinned: PINNED, groupIndian: GROUP_INDIAN };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CURRENCIES = api;
})(typeof window !== 'undefined' ? window : globalThis);
