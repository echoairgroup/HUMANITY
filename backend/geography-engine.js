'use strict';

const crypto = require('node:crypto');

const POINTS_BY_LEVEL = [10, 20, 40, 60, 80, 100];
const LEVEL_NAMES = ['Familiar', 'Known', 'Uncommon', 'Rare', 'Remarkable', 'Exceptional'];

function normaliseAnswer(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function answer(name, aliases, rarity, source) {
  return {
    name,
    aliases: Array.isArray(aliases) ? aliases : [],
    rarity: Math.max(0, Math.min(5, Number(rarity) || 0)),
    source: source || 'HUMANITY curated geography dataset'
  };
}

const Q = [
  {
    id: 'europe-countries', domain: 'geography', category: 'Countries in Europe',
    prompt: 'Name a country in Europe.',
    note: 'Think across the continent, including its smaller states.',
    source: 'UN M49 country and area classification; curated aliases',
    answers: [
      answer('Albania', ['Shqipëria'], 3), answer('Andorra', [], 5),
      answer('Austria', ['Österreich'], 1), answer('Belarus', [], 2),
      answer('Belgium', ['België', 'Belgique'], 0), answer('Bosnia and Herzegovina', ['Bosnia', 'BiH'], 3),
      answer('Bulgaria', ['България'], 1), answer('Croatia', ['Hrvatska'], 1),
      answer('Cyprus', ['Κύπρος'], 2), answer('Czechia', ['Czech Republic', 'Česko'], 1),
      answer('Denmark', ['Danmark'], 0), answer('Estonia', ['Eesti'], 2),
      answer('Finland', ['Suomi'], 0), answer('France', ['République française'], 0),
      answer('Germany', ['Deutschland', 'Allemagne'], 0), answer('Greece', ['Hellas', 'Ελλάδα'], 0),
      answer('Hungary', ['Magyarország'], 1), answer('Iceland', ['Ísland'], 2),
      answer('Ireland', ['Éire'], 0), answer('Italy', ['Italia'], 0),
      answer('Kosovo', [], 4), answer('Latvia', ['Latvija'], 2),
      answer('Liechtenstein', [], 5), answer('Lithuania', ['Lietuva'], 2),
      answer('Luxembourg', ['Lëtzebuerg'], 3), answer('Malta', [], 3),
      answer('Moldova', ['Republic of Moldova'], 3), answer('Monaco', [], 5),
      answer('Montenegro', ['Crna Gora'], 4), answer('Netherlands', ['The Netherlands', 'Holland', 'Nederland', 'Pays-Bas'], 0),
      answer('North Macedonia', ['Macedonia', 'Северна Македонија'], 3), answer('Norway', ['Norge'], 0),
      answer('Poland', ['Polska'], 0), answer('Portugal', [], 0),
      answer('Romania', ['România'], 0), answer('Russia', ['Russian Federation', 'Россия'], 0),
      answer('San Marino', [], 5), answer('Serbia', ['Srbija'], 1),
      answer('Slovakia', ['Slovensko'], 1), answer('Slovenia', ['Slovenija'], 1),
      answer('Spain', ['España', 'Espagne'], 0), answer('Sweden', ['Sverige'], 0),
      answer('Switzerland', ['Schweiz', 'Suisse', 'Svizzera'], 0), answer('Ukraine', ['Україна'], 0),
      answer('United Kingdom', ['UK', 'Britain', 'Great Britain', 'Britain and Northern Ireland'], 0),
      answer('Vatican City', ['Vatican'], 5)
    ]
  },
  {
    id: 'africa-countries', domain: 'geography', category: 'Countries in Africa',
    prompt: 'Name a country in Africa.',
    note: 'Any sovereign country on the African continent is eligible.',
    source: 'UN M49 country and area classification',
    answers: [
      answer('Algeria', ['Al Jazair'], 0), answer('Angola', [], 1), answer('Benin', [], 2),
      answer('Botswana', [], 2), answer('Burkina Faso', [], 2), answer('Burundi', [], 3),
      answer('Cabo Verde', ['Cape Verde'], 4), answer('Cameroon', ['Cameroun'], 0),
      answer('Central African Republic', ['CAR'], 3), answer('Chad', ['Tchad'], 2),
      answer('Comoros', [], 4), answer('Democratic Republic of the Congo', ['DR Congo', 'DRC', 'Congo Kinshasa'], 1),
      answer('Republic of the Congo', ['Congo Republic', 'Congo Brazzaville'], 3), answer('Djibouti', [], 3),
      answer('Egypt', ['Misr'], 0), answer('Equatorial Guinea', [], 4), answer('Eritrea', [], 3),
      answer('Eswatini', ['Swaziland'], 4), answer('Ethiopia', ['Äthiopien'], 0),
      answer('Gabon', [], 2), answer('Gambia', ['The Gambia'], 2), answer('Ghana', [], 0),
      answer('Guinea', [], 1), answer('Guinea-Bissau', [], 4), answer('Ivory Coast', ['Côte d’Ivoire', 'Cote d Ivoire'], 1),
      answer('Kenya', [], 0), answer('Lesotho', [], 4), answer('Liberia', [], 2),
      answer('Libya', ['Libiya'], 1), answer('Madagascar', [], 0), answer('Malawi', [], 1),
      answer('Mali', [], 1), answer('Mauritania', [], 2), answer('Mauritius', [], 2),
      answer('Morocco', ['Maroc', 'Al Maghrib'], 0), answer('Mozambique', [], 1),
      answer('Namibia', [], 1), answer('Niger', [], 1), answer('Nigeria', [], 0),
      answer('Rwanda', [], 0), answer('Senegal', ['Sénégal'], 0), answer('Seychelles', [], 4),
      answer('Sierra Leone', [], 2), answer('Somalia', [], 0), answer('South Africa', [], 0),
      answer('South Sudan', [], 2), answer('Sudan', [], 0), answer('Tanzania', [], 0),
      answer('Togo', [], 2), answer('Tunisia', ['Tunisie'], 0), answer('Uganda', [], 0),
      answer('Zambia', [], 0), answer('Zimbabwe', [], 0)
    ]
  },
  {
    id: 'asia-countries', domain: 'geography', category: 'Countries in Asia',
    prompt: 'Name a country in Asia.',
    note: 'From the Middle East to East Asia, the whole continent counts.',
    source: 'UN M49 country and area classification',
    answers: [
      answer('Afghanistan', [], 0), answer('Armenia', ['Հայաստան'], 2), answer('Azerbaijan', ['Azərbaycan'], 2),
      answer('Bahrain', [], 2), answer('Bangladesh', ['বাংলাদেশ'], 0), answer('Bhutan', ['Druk Yul'], 4),
      answer('Brunei', ['Brunei Darussalam'], 3), answer('Cambodia', ['Kampuchea'], 1),
      answer('China', ['People’s Republic of China', 'PRC', '中国'], 0), answer('Georgia', ['Sakartvelo'], 1),
      answer('India', ['भारत'], 0), answer('Indonesia', [], 0), answer('Iran', ['Persia'], 0),
      answer('Iraq', [], 0), answer('Israel', [], 0), answer('Japan', ['日本'], 0),
      answer('Jordan', ['Hashemite Kingdom of Jordan'], 0), answer('Kazakhstan', ['Qazaqstan'], 1),
      answer('Kuwait', [], 1), answer('Kyrgyzstan', ['Kyrgyz Republic'], 2), answer('Laos', ['Lao PDR'], 2),
      answer('Lebanon', ['Lubnan'], 0), answer('Malaysia', [], 0), answer('Maldives', [], 2),
      answer('Mongolia', ['Монгол улс'], 1), answer('Myanmar', ['Burma'], 1), answer('Nepal', ['नेपाल'], 0),
      answer('North Korea', ['DPRK', 'Democratic People’s Republic of Korea'], 1), answer('Oman', [], 1),
      answer('Pakistan', [], 0), answer('Palestine', ['State of Palestine'], 1), answer('Philippines', [], 0),
      answer('Qatar', [], 1), answer('Saudi Arabia', ['KSA'], 0), answer('Singapore', [], 0),
      answer('South Korea', ['Republic of Korea', 'Korea'], 0), answer('Sri Lanka', ['Ceylon'], 1),
      answer('Syria', ['Syrian Arab Republic'], 0), answer('Tajikistan', [], 2),
      answer('Thailand', ['ประเทศไทย'], 0), answer('Timor-Leste', ['East Timor'], 3),
      answer('Turkey', ['Türkiye', 'Turkiye'], 0), answer('Turkmenistan', [], 2),
      answer('United Arab Emirates', ['UAE', 'Emirates'], 0), answer('Uzbekistan', [], 1),
      answer('Vietnam', ['Viet Nam', 'Việt Nam'], 0), answer('Yemen', [], 0)
    ]
  },
  {
    id: 'south-america-countries', domain: 'geography', category: 'Countries in South America',
    prompt: 'Name a country in South America.',
    note: 'Remember that the continent has both large and very small countries.',
    source: 'UN M49 country and area classification',
    answers: [
      answer('Argentina', [], 0), answer('Bolivia', ['Estado Plurinacional de Bolivia'], 1),
      answer('Brazil', ['Brasil'], 0), answer('Chile', [], 0), answer('Colombia', [], 0),
      answer('Ecuador', [], 0), answer('Guyana', [], 2), answer('Paraguay', [], 1),
      answer('Peru', ['Perú'], 0), answer('Suriname', ['Surinam'], 3),
      answer('Uruguay', [], 1), answer('Venezuela', [], 0)
    ]
  },
  {
    id: 'world-rivers', domain: 'geography', category: 'Rivers',
    prompt: 'Name a major river in the world.',
    note: 'Rivers from every continent are welcome.',
    source: 'Wikidata and curated geographic reference list',
    answers: [
      answer('Amazon River', ['Amazonas', 'Amazon'], 0), answer('Nile', ['Nile River'], 0),
      answer('Yangtze', ['Yangtze River', 'Chang Jiang'], 0), answer('Mississippi', ['Mississippi River'], 0),
      answer('Yellow River', ['Huang He', 'Huanghe'], 1), answer('Ganges', ['Ganga', 'Ganges River'], 0),
      answer('Congo River', ['Congo'], 1), answer('Mekong', ['Mekong River'], 1),
      answer('Danube', ['Donau', 'Danube River'], 0), answer('Rhine', ['Rhein', 'Rhine River'], 0),
      answer('Volga', ['Volga River'], 1), answer('Zambezi', ['Zambezi River'], 1),
      answer('Niger River', ['Niger'], 1), answer('Indus', ['Indus River'], 1),
      answer('Euphrates', ['Euphrates River'], 1), answer('Tigris', ['Tigris River'], 1),
      answer('Murray River', ['Murray'], 2), answer('Lena', ['Lena River'], 2),
      answer('Ob River', ['Ob'], 2), answer('Paraná', ['Parana River', 'Parana'], 1),
      answer('Orinoco', ['Orinoco River'], 2), answer('Colorado River', ['Colorado'], 1),
      answer('Yukon River', ['Yukon'], 2), answer('Thames', ['River Thames'], 0),
      answer('Seine', ['Seine River'], 0), answer('Loire', ['Loire River'], 1),
      answer('Po River', ['Po'], 1), answer('Dnieper', ['Dnipro', 'Dnieper River'], 1)
    ]
  },
  {
    id: 'mountains', domain: 'geography', category: 'Mountains and peaks',
    prompt: 'Name a famous mountain or mountain peak.',
    note: 'Individual peaks and well-known mountain massifs both count.',
    source: 'Wikidata and curated geographic reference list',
    answers: [
      answer('Mount Everest', ['Everest', 'Sagarmatha', 'Chomolungma'], 0),
      answer('K2', ['Mount Godwin-Austen', 'Chhogori'], 2),
      answer('Kilimanjaro', ['Mount Kilimanjaro'], 0), answer('Mont Blanc', [], 0),
      answer('Matterhorn', ['Monte Cervino'], 1), answer('Denali', ['Mount McKinley'], 1),
      answer('Aconcagua', ['Cerro Aconcagua'], 1), answer('Mount Fuji', ['Fuji', 'Fujisan'], 0),
      answer('Mount Elbrus', ['Elbrus'], 1), answer('Vinson Massif', ['Mount Vinson'], 3),
      answer('Puncak Jaya', ['Carstensz Pyramid'], 3), answer('Table Mountain', [], 0),
      answer('Ben Nevis', [], 1), answer('Mount Etna', ['Etna'], 0),
      answer('Mount Vesuvius', ['Vesuvius'], 0), answer('Mount Ararat', ['Ararat'], 1),
      answer('Mount Kosciuszko', ['Kosciuszko'], 2), answer('Mauna Kea', [], 1),
      answer('Mount Roraima', ['Roraima'], 2), answer('Eiger', [], 1),
      answer('Jungfrau', [], 2), answer('Mount Rainier', ['Rainier'], 1)
    ]
  },
  {
    id: 'islands', domain: 'geography', category: 'Islands',
    prompt: 'Name a well-known island in the world.',
    note: 'Large islands and smaller named islands are welcome.',
    source: 'Wikidata and curated geographic reference list',
    answers: [
      answer('Greenland', ['Kalaallit Nunaat'], 0), answer('Madagascar', [], 0),
      answer('Borneo', ['Kalimantan'], 0), answer('New Guinea', ['Papua'], 0),
      answer('Baffin Island', [], 2), answer('Sumatra', ['Sumatera'], 0),
      answer('Honshu', ['本州'], 1), answer('Hokkaido', ['北海道'], 1),
      answer('Java', ['Jawa'], 0), answer('Sri Lanka', ['Ceylon'], 0),
      answer('Iceland', ['Ísland'], 0), answer('Ireland', ['Éire'], 0),
      answer('Cuba', [], 0), answer('Hispaniola', [], 2),
      answer('Tasmania', [], 0), answer('Sicily', ['Sicilia'], 0),
      answer('Sardinia', ['Sardegna'], 1), answer('Corsica', ['Corse'], 1),
      answer('Crete', ['Kriti'], 0), answer('Cyprus', ['Κύπρος'], 0),
      answer('Bali', [], 0), answer('Sakhalin', [], 2),
      answer('Luzon', [], 1), answer('Mindanao', [], 1),
      answer('Easter Island', ['Rapa Nui'], 2), answer('Faroe Islands', ['Faroes'], 1)
    ]
  },
  {
    id: 'lakes', domain: 'geography', category: 'Lakes',
    prompt: 'Name a major lake in the world.',
    note: 'Freshwater and saltwater lakes both count.',
    source: 'Wikidata and curated geographic reference list',
    answers: [
      answer('Lake Superior', ['Superior'], 0), answer('Lake Victoria', ['Victoria'], 0),
      answer('Lake Baikal', ['Baikal'], 0), answer('Lake Tanganyika', ['Tanganyika'], 1),
      answer('Lake Malawi', ['Lake Nyasa', 'Nyasa'], 1), answer('Lake Huron', ['Huron'], 1),
      answer('Lake Michigan', ['Michigan'], 0), answer('Lake Ontario', ['Ontario'], 0),
      answer('Lake Erie', ['Erie'], 0), answer('Caspian Sea', ['Caspian'], 0),
      answer('Aral Sea', ['Aral'], 1), answer('Dead Sea', [], 0),
      answer('Lake Titicaca', ['Titicaca'], 1), answer('Lake Chad', ['Chad'], 1),
      answer('Lake Ladoga', ['Ladoga'], 2), answer('Lake Onega', ['Onega'], 2),
      answer('Lake Geneva', ['Lac Léman', 'Leman'], 1), answer('Lake Como', ['Como'], 1),
      answer('Lake Tahoe', ['Tahoe'], 1), answer('Great Salt Lake', [], 1),
      answer('Lake Winnipeg', ['Winnipeg'], 1), answer('Lake Nicaragua', ['Cocibolca'], 2)
    ]
  },
  {
    id: 'seas', domain: 'geography', category: 'Seas and oceans',
    prompt: 'Name a sea or ocean.',
    note: 'Use the name of a recognised sea or ocean.',
    source: 'International Hydrographic Organization names and curated list',
    answers: [
      answer('Pacific Ocean', ['Pacific'], 0), answer('Atlantic Ocean', ['Atlantic'], 0),
      answer('Indian Ocean', ['Indian'], 0), answer('Arctic Ocean', ['Arctic'], 0),
      answer('Southern Ocean', ['Antarctic Ocean'], 1), answer('Mediterranean Sea', ['Mediterranean'], 0),
      answer('Caribbean Sea', ['Caribbean'], 0), answer('Baltic Sea', ['Baltic'], 0),
      answer('Black Sea', [], 0), answer('Red Sea', [], 0),
      answer('North Sea', [], 0), answer('Arabian Sea', [], 1),
      answer('South China Sea', [], 1), answer('Coral Sea', [], 1),
      answer('Bering Sea', [], 2), answer('Sea of Japan', ['East Sea'], 1),
      answer('Aegean Sea', ['Aegean'], 1), answer('Adriatic Sea', ['Adriatic'], 1),
      answer('Ionian Sea', ['Ionian'], 2), answer('Weddell Sea', [], 3),
      answer('Labrador Sea', [], 2), answer('Tasman Sea', [], 2)
    ]
  },
  {
    id: 'deserts', domain: 'geography', category: 'Deserts',
    prompt: 'Name a desert in the world.',
    note: 'Hot, cold and polar deserts all count.',
    source: 'Wikidata and curated geographic reference list',
    answers: [
      answer('Sahara', ['Sahara Desert'], 0), answer('Gobi Desert', ['Gobi'], 0),
      answer('Arabian Desert', ['Rub al Khali', 'Empty Quarter'], 1),
      answer('Kalahari Desert', ['Kalahari'], 1), answer('Namib Desert', ['Namib'], 1),
      answer('Atacama Desert', ['Atacama'], 1), answer('Mojave Desert', ['Mojave'], 0),
      answer('Sonoran Desert', ['Sonoran'], 1), answer('Chihuahuan Desert', ['Chihuahua Desert'], 2),
      answer('Great Victoria Desert', [], 2), answer('Great Sandy Desert', [], 2),
      answer('Thar Desert', ['Great Indian Desert'], 1), answer('Karakum Desert', ['Karakum'], 2),
      answer('Kyzylkum Desert', ['Kyzyl Kum'], 2), answer('Taklamakan Desert', ['Taklamakan'], 2),
      answer('Syrian Desert', ['Syrian steppe'], 2), answer('Patagonian Desert', ['Patagonia Desert'], 2),
      answer('Antarctic Desert', ['Antarctica'], 1), answer('Arctic Desert', [], 2)
    ]
  },
  {
    id: 'capital-cities', domain: 'geography', category: 'Capital cities',
    prompt: 'Name a national capital city.',
    note: 'The answer must be a national capital, not just a large city.',
    source: 'CIA World Factbook and national government references',
    answers: [
      answer('Amsterdam', [], 0), answer('Abu Dhabi', [], 0), answer('Accra', [], 1),
      answer('Addis Ababa', [], 1), answer('Algiers', [], 0), answer('Ankara', [], 0),
      answer('Athens', ['Αθήνα'], 0), answer('Bangkok', ['Krung Thep'], 0),
      answer('Beijing', ['Peking', '北京'], 0), answer('Berlin', [], 0),
      answer('Bern', ['Berne'], 1), answer('Brasília', ['Brasilia'], 0),
      answer('Brussels', ['Bruxelles', 'Brussel'], 0), answer('Budapest', [], 0),
      answer('Buenos Aires', [], 0), answer('Cairo', ['Al Qahira'], 0),
      answer('Canberra', [], 0), answer('Copenhagen', ['København'], 0),
      answer('Dakar', [], 1), answer('Hanoi', ['Hà Nội'], 0),
      answer('Helsinki', [], 0), answer('Islamabad', [], 0),
      answer('Jakarta', [], 0), answer('Jerusalem', [], 0),
      answer('Kabul', [], 1), answer('Kathmandu', ['काठमाडौँ'], 1),
      answer('Kigali', [], 2), answer('Kuala Lumpur', [], 0),
      answer('Kyiv', ['Kiev', 'Київ'], 0), answer('Lima', [], 0),
      answer('Lisbon', ['Lisboa'], 0), answer('London', [], 0),
      answer('Madrid', [], 0), answer('Mexico City', ['Ciudad de México'], 0),
      answer('Moscow', ['Moskva', 'Москва'], 0), answer('Nairobi', [], 0),
      answer('New Delhi', ['Delhi'], 0), answer('Oslo', [], 0),
      answer('Ottawa', [], 0), answer('Paris', [], 0),
      answer('Prague', ['Praha'], 0), answer('Reykjavík', ['Reykjavik'], 1),
      answer('Riyadh', [], 0), answer('Rome', ['Roma'], 0),
      answer('Seoul', ['서울'], 0), answer('Stockholm', [], 0),
      answer('Taipei', [], 1), answer('Tashkent', [], 2),
      answer('Tbilisi', [], 1), answer('Tokyo', ['東京'], 0),
      answer('Ulaanbaatar', ['Ulan Bator'], 2), answer('Vienna', ['Wien'], 0),
      answer('Warsaw', ['Warszawa'], 0), answer('Wellington', [], 0)
    ]
  },
  {
    id: 'major-cities', domain: 'geography', category: 'Major cities',
    prompt: 'Name a major city in the world.',
    note: 'Think of cities with international or regional significance.',
    source: 'UN urban agglomerations and curated geographic reference list',
    answers: [
      answer('New York City', ['New York', 'NYC'], 0), answer('Los Angeles', ['LA'], 0),
      answer('Chicago', [], 0), answer('Toronto', [], 0), answer('Vancouver', [], 1),
      answer('Mexico City', ['Ciudad de México'], 0), answer('São Paulo', ['Sao Paulo'], 0),
      answer('Rio de Janeiro', ['Rio'], 0), answer('Buenos Aires', [], 0),
      answer('London', [], 0), answer('Paris', [], 0), answer('Madrid', [], 0),
      answer('Barcelona', [], 0), answer('Berlin', [], 0), answer('Istanbul', ['İstanbul'], 0),
      answer('Cairo', [], 0), answer('Lagos', [], 0), answer('Johannesburg', [], 0),
      answer('Nairobi', [], 0), answer('Dubai', [], 0), answer('Mumbai', ['Bombay'], 0),
      answer('Delhi', ['New Delhi'], 0), answer('Dhaka', [], 0), answer('Bangkok', [], 0),
      answer('Singapore', [], 0), answer('Jakarta', [], 0), answer('Manila', [], 0),
      answer('Seoul', [], 0), answer('Tokyo', [], 0), answer('Shanghai', ['上海'], 0),
      answer('Beijing', ['Peking'], 0), answer('Hong Kong', [], 0), answer('Sydney', [], 0),
      answer('Melbourne', [], 0), answer('Auckland', [], 1), answer('Perth', [], 1)
    ]
  },
  {
    id: 'island-countries', domain: 'geography', category: 'Island countries',
    prompt: 'Name an island country.',
    note: 'Sovereign island states and archipelagos both count.',
    source: 'UN M49 country classification',
    answers: [
      answer('Japan', ['日本'], 0), answer('Iceland', ['Ísland'], 0),
      answer('Madagascar', [], 0), answer('Sri Lanka', ['Ceylon'], 0),
      answer('Cuba', [], 0), answer('Jamaica', [], 0), answer('Haiti', [], 0),
      answer('Dominican Republic', ['DR'], 0), answer('Bahamas', ['The Bahamas'], 1),
      answer('Barbados', [], 1), answer('Trinidad and Tobago', ['Trinidad'], 0),
      answer('Fiji', [], 1), answer('Samoa', [], 2), answer('Tonga', [], 2),
      answer('Vanuatu', [], 2), answer('Solomon Islands', [], 1),
      answer('Kiribati', [], 3), answer('Tuvalu', [], 4), answer('Nauru', [], 4),
      answer('Palau', [], 3), answer('Maldives', [], 1), answer('Seychelles', [], 2),
      answer('Mauritius', [], 1), answer('Comoros', [], 3), answer('Malta', [], 1),
      answer('Cyprus', [], 0), answer('New Zealand', [], 0)
    ]
  },
  {
    id: 'popular-snacks', domain: 'culture', category: 'Snacks around the world',
    prompt: 'Name a popular snack in the world.',
    note: 'Regional and locally named snacks count when they are established foods.',
    source: 'HUMANITY regional food reference set; entries are reviewed before play',
    answers: [
      answer('Kroket', ['Croquette', 'Dutch croquette', 'Rundvleeskroket', 'Kroketten'], 4),
      answer('Samosa', ['Samosa chaat'], 0), answer('Empanada', ['Empanadas'], 1),
      answer('Spring roll', ['Spring rolls', 'Lumpia'], 0), answer('Falafel', [], 0),
      answer('Takoyaki', [], 2), answer('Onigiri', ['Omusubi'], 1),
      answer('Pretzel', ['Brezel'], 0), answer('Nachos', [], 0),
      answer('Popcorn', [], 0), answer('Potato chips', ['Crisps', 'Chips'], 0),
      answer('Dumplings', ['Dumpling', 'Jiaozi', 'Gyoza'], 0),
      answer('Pani puri', ['Gol gappa', 'Golgappa', 'Phuchka'], 2),
      answer('Churros', [], 0), answer('Arepa', ['Arepas'], 1),
      answer('Poutine', [], 2), answer('Arancini', [], 2),
      answer('Börek', ['Borek'], 2), answer('Baozi', ['Bao'], 1),
      answer('Kimbap', ['Gimbap'], 2), answer('Sushi', [], 0),
      answer('Satay', ['Sate'], 1), answer('Biltong', [], 3),
      answer('Plantain chips', ['Plantain crisps'], 2), answer('Hummus', [], 0),
      answer('Bruschetta', [], 1), answer('Scotch egg', [], 3),
      answer('Pastel', ['Pastel de feira'], 3), answer('Pão de queijo', ['Pao de queijo', 'Brazilian cheese bread'], 1),
      answer('Kachori', [], 3), answer('Bánh tráng trộn', ['Rice paper salad'], 4),
      answer('Pocky', [], 1), answer('Edamame', [], 1)
    ]
  },
  {
    id: 'popular-dishes', domain: 'culture', category: 'World cuisines',
    prompt: 'Name a well-known dish from a country or region.',
    note: 'Traditional dishes and widely recognised regional foods count.',
    source: 'HUMANITY curated food reference set',
    answers: [
      answer('Pizza', [], 0), answer('Sushi', [], 0), answer('Paella', [], 1),
      answer('Curry', ['Curry dish'], 0), answer('Ramen', [], 0), answer('Pho', ['Phở'], 1),
      answer('Pad Thai', [], 0), answer('Biryani', [], 0), answer('Tagine', ['Tajine'], 1),
      answer('Moussaka', [], 2), answer('Pierogi', ['Pirogi'], 1), answer('Goulash', [], 1),
      answer('Ceviche', [], 1), answer('Feijoada', [], 2), answer('Jollof rice', ['Jollof'], 1),
      answer('Arepas', ['Arepa'], 1), answer('Kimchi jjigae', [], 3),
      answer('Bibimbap', [], 1), answer('Fish and chips', [], 0),
      answer('Rendang', [], 2), answer('Laksa', [], 2), answer('Mole poblano', ['Mole'], 3),
      answer('Ratatouille', [], 1), answer('Gnocchi', [], 1), answer('Couscous', [], 0),
      answer('Kroket', ['Croquette'], 4), answer('Sauerbraten', [], 3),
      answer('Gumbo', [], 2), answer('Borscht', ['Borsch'], 1)
    ]
  },
  {
    id: 'languages', domain: 'culture', category: 'Languages',
    prompt: 'Name a language spoken in more than one country.',
    note: 'Official and widely spoken languages both count.',
    source: 'Ethnologue and national language references',
    answers: [
      answer('English', [], 0), answer('Spanish', ['Español', 'Castilian'], 0),
      answer('French', ['Français'], 0), answer('Arabic', ['Modern Standard Arabic'], 0),
      answer('Portuguese', ['Português'], 0), answer('German', ['Deutsch'], 0),
      answer('Dutch', ['Nederlands', 'Flemish'], 1), answer('Swahili', ['Kiswahili'], 1),
      answer('Russian', ['Русский'], 0), answer('Chinese', ['Mandarin', '普通话'], 0),
      answer('Hindi', ['हिन्दी'], 0), answer('Bengali', ['Bangla', 'বাংলা'], 1),
      answer('Urdu', ['اردو'], 1), answer('Persian', ['Farsi', 'فارسی'], 1),
      answer('Turkish', ['Türkçe'], 0), answer('Italian', ['Italiano'], 0),
      answer('Greek', ['Ελληνικά'], 1), answer('Korean', ['한국어'], 0),
      answer('Japanese', ['日本語'], 0), answer('Malay', ['Bahasa Melayu'], 1),
      answer('Indonesian', ['Bahasa Indonesia'], 0), answer('Romanian', ['Română'], 1),
      answer('Serbian', ['Српски'], 1), answer('Tamil', ['தமிழ்'], 1),
      answer('Azerbaijani', ['Azərbaycan dili'], 2)
    ]
  },
  {
    id: 'world-landmarks', domain: 'geography', category: 'Landmarks',
    prompt: 'Name a famous landmark in the world.',
    note: 'Natural and human-made landmarks are accepted.',
    source: 'UNESCO World Heritage and national heritage reference lists',
    answers: [
      answer('Eiffel Tower', ['Tour Eiffel'], 0), answer('Great Wall of China', ['Great Wall'], 0),
      answer('Taj Mahal', [], 0), answer('Machu Picchu', [], 1), answer('Colosseum', ['Coliseum'], 0),
      answer('Petra', [], 1), answer('Christ the Redeemer', ['Cristo Redentor'], 0),
      answer('Statue of Liberty', [], 0), answer('Acropolis of Athens', ['Acropolis'], 0),
      answer('Sydney Opera House', [], 0), answer('Angkor Wat', [], 1),
      answer('Burj Khalifa', [], 0), answer('Mount Rushmore', [], 1),
      answer('Stonehenge', [], 0), answer('Pyramids of Giza', ['Great Pyramids', 'Pyramids'], 0),
      answer('Hagia Sophia', ['Ayasofya'], 1), answer('Chichen Itza', ['Chichén Itzá'], 1),
      answer('Sagrada Familia', ['Basílica de la Sagrada Família'], 0),
      answer('Moai', ['Easter Island statues'], 3), answer('Golden Gate Bridge', [], 0)
    ]
  },
  {
    id: 'flag-colours-blue-white-red', domain: 'geography', type: 'flags', category: 'Flags · Blue, white & red',
    prompt: 'Name a country whose national flag contains blue, white and red.',
    note: 'All three colours must appear somewhere in the national flag.',
    source: 'National flag reference set',
    visual: { kind: 'flag-colours', colors: ['#e84a5b', '#f7f8fb', '#3977c9'] },
    answers: [
      answer('Netherlands', ['The Netherlands', 'Nederland'], 0), answer('France', [], 0),
      answer('United States', ['USA', 'United States of America'], 0), answer('United Kingdom', ['UK', 'Britain'], 0),
      answer('Russia', [], 0), answer('Norway', [], 1), answer('Iceland', [], 1),
      answer('Czechia', ['Czech Republic'], 1), answer('Slovakia', [], 1), answer('Slovenia', [], 1),
      answer('Croatia', [], 1), answer('Serbia', [], 1), answer('Australia', [], 0),
      answer('New Zealand', [], 1), answer('Chile', [], 1), answer('Paraguay', [], 2),
      answer('Panama', [], 2), answer('Costa Rica', [], 2)
    ]
  },
  {
    id: 'flag-colours-red-white-green', domain: 'geography', type: 'flags', category: 'Flags · Red, white & green',
    prompt: 'Name a country whose national flag contains red, white and green.',
    note: 'Look for these three colours in any arrangement.',
    source: 'National flag reference set',
    visual: { kind: 'flag-colours', colors: ['#e84a5b', '#f7f8fb', '#3c9b68'] },
    answers: [
      answer('Italy', ['Italia'], 0), answer('Mexico', ['México'], 0),
      answer('Hungary', [], 0), answer('Bulgaria', [], 0), answer('Iran', [], 1),
      answer('Madagascar', [], 1), answer('Belarus', [], 1), answer('Oman', [], 1),
      answer('Lebanon', [], 1), answer('Algeria', [], 1), answer('Azerbaijan', [], 1),
      answer('Tajikistan', [], 2), answer('Turkmenistan', [], 2), answer('Uzbekistan', [], 2),
      answer('Maldives', [], 2), answer('Suriname', [], 2)
    ]
  },
  {
    id: 'flag-colours-stars', domain: 'geography', type: 'flags', category: 'Flags · Stars',
    prompt: 'Name a country whose national flag features at least one star.',
    note: 'A star can be large, small or part of a group of stars.',
    source: 'National flag reference set',
    visual: { kind: 'symbol', text: '✦', label: 'STAR ON A FLAG' },
    answers: [
      answer('United States', ['USA', 'United States of America'], 0), answer('China', [], 0),
      answer('Brazil', ['Brasil'], 0), answer('Australia', [], 0), answer('New Zealand', [], 0),
      answer('Vietnam', ['Viet Nam'], 0), answer('Turkey', ['Türkiye'], 0), answer('Somalia', [], 1),
      answer('Ghana', [], 1), answer('Morocco', [], 1), answer('Chile', [], 1),
      answer('Israel', [], 1), answer('Pakistan', [], 1), answer('Singapore', [], 1),
      answer('Cuba', [], 1), answer('Myanmar', ['Burma'], 2)
    ]
  },
  {
    id: 'euro-countries', domain: 'geography', type: 'currency', category: 'Currencies · Euro',
    prompt: 'Name a country that uses the euro as its official currency.',
    note: 'Think of countries in the euro area, including smaller European states.',
    source: 'European Central Bank euro area reference',
    visual: { kind: 'symbol', text: '€', label: 'EURO' },
    answers: [
      answer('Netherlands', ['The Netherlands', 'Nederland'], 0), answer('Germany', ['Deutschland'], 0),
      answer('France', [], 0), answer('Spain', ['España'], 0), answer('Italy', ['Italia'], 0),
      answer('Belgium', [], 0), answer('Austria', [], 0), answer('Portugal', [], 0),
      answer('Ireland', [], 0), answer('Finland', [], 0), answer('Greece', ['Hellas'], 0),
      answer('Croatia', [], 1), answer('Slovenia', [], 1), answer('Slovakia', [], 1),
      answer('Estonia', [], 1), answer('Latvia', [], 1), answer('Lithuania', [], 1),
      answer('Bulgaria', ['България'], 0),
      answer('Luxembourg', [], 1), answer('Malta', [], 1), answer('Cyprus', [], 1)
    ]
  },
  {
    id: 'landlocked-capitals', domain: 'geography', type: 'cities', category: 'Capital cities · Landlocked countries',
    prompt: 'Name the capital city of a landlocked country.',
    note: 'The country has no coastline, and the answer must be its national capital.',
    source: 'National capital and country reference set',
    visual: { kind: 'symbol', text: '⌖', label: 'CAPITAL CITY' },
    answers: [
      answer('Vienna', ['Wien'], 0), answer('Bern', [], 0), answer('Prague', ['Praha'], 0),
      answer('Budapest', [], 0), answer('Bratislava', [], 1), answer('Ljubljana', [], 1),
      answer('Luxembourg City', ['Luxembourg'], 1), answer('Andorra la Vella', [], 2),
      answer('Vaduz', [], 2), answer('Skopje', [], 1), answer('Belgrade', [], 0),
      answer('Sarajevo', [], 1), answer('Zagreb', [], 0), answer('Minsk', [], 1),
      answer('Chisinau', ['Chișinău'], 2), answer('Kigali', [], 1),
      answer('Kampala', [], 1), answer('Addis Ababa', [], 1),
      answer('Ulaanbaatar', [], 2), answer('Kathmandu', [], 1), answer('Thimphu', [], 2),
      answer("Vientiane", [], 2), answer("N'Djamena", ['Ndjamena'], 3),
      answer('Niamey', [], 2), answer('Ouagadougou', [], 2), answer('Bamako', [], 1),
      answer('Lusaka', [], 1), answer('Harare', [], 1), answer('Asuncion', ['Asunción'], 1)
    ]
  },
  {
    id: 'world-heritage-sites', domain: 'geography', type: 'landmarks', category: 'World heritage sites',
    prompt: 'Name a UNESCO World Heritage Site.',
    note: 'Historic cities, buildings and natural sites can all count.',
    source: 'UNESCO World Heritage reference list',
    visual: { kind: 'symbol', text: '✦', label: 'WORLD HERITAGE' },
    answers: [
      answer('Taj Mahal', [], 0), answer('Machu Picchu', [], 0), answer('Petra', [], 0),
      answer('Angkor Wat', [], 0), answer('Acropolis of Athens', ['Acropolis'], 0),
      answer('Historic Centre of Rome', ['Rome Historic Centre'], 1), answer('Great Wall of China', ['Great Wall'], 0),
      answer('Galapagos Islands', ['Galápagos Islands'], 1), answer('Serengeti National Park', [], 1),
      answer('Yellowstone National Park', [], 1), answer('Stonehenge', [], 0),
      answer('Pyramids of Giza', ['Giza Pyramids'], 0), answer('Kyoto Historic Monuments', ['Historic Monuments of Ancient Kyoto'], 2),
      answer('Old City of Jerusalem', ['Jerusalem Old City'], 1), answer('Mont-Saint-Michel', [], 1),
      answer('Historic Sanctuary of Cartagena', ['Cartagena de Indias'], 2)
    ]
  },
  {
    id: 'national-parks', domain: 'geography', type: 'nature', category: 'National parks',
    prompt: 'Name a national park anywhere in the world.',
    note: 'Parks on land and at sea both count.',
    source: 'National park authority reference lists',
    visual: { kind: 'symbol', text: '♧', label: 'NATIONAL PARK' },
    answers: [
      answer('Yellowstone National Park', ['Yellowstone'], 0), answer('Serengeti National Park', ['Serengeti'], 0),
      answer('Kruger National Park', ['Kruger'], 0), answer('Banff National Park', ['Banff'], 0),
      answer('Yosemite National Park', ['Yosemite'], 0), answer('Plitvice Lakes National Park', ['Plitvice Lakes'], 1),
      answer('Fiordland National Park', ['Fiordland'], 1), answer('Torres del Paine National Park', ['Torres del Paine'], 1),
      answer('Komodo National Park', ['Komodo'], 1), answer('Iguazu National Park', ['Iguazú'], 1),
      answer('Grand Canyon National Park', ['Grand Canyon'], 0), answer('Everglades National Park', ['Everglades'], 1),
      answer('Galapagos National Park', ['Galápagos National Park'], 1), answer('Kakadu National Park', ['Kakadu'], 1),
      answer('Arenal Volcano National Park', ['Arenal Volcano'], 2), answer('Chitwan National Park', ['Chitwan'], 2)
    ]
  },
  {
    id: 'olympic-sports', domain: 'culture', type: 'culture', category: 'Sports around the world',
    prompt: 'Name a sport that has featured in the Olympic Games.',
    note: 'Summer and Winter Olympic sports both count.',
    source: 'International Olympic Committee sports programme',
    visual: { kind: 'symbol', text: '◎', label: 'OLYMPIC SPORTS' },
    answers: [
      answer('Athletics', ['Track and field'], 0), answer('Swimming', [], 0), answer('Gymnastics', [], 0),
      answer('Cycling', [], 0), answer('Fencing', [], 1), answer('Judo', [], 1),
      answer('Basketball', [], 0), answer('Football', ['Soccer'], 0), answer('Tennis', [], 0),
      answer('Archery', [], 1), answer('Rowing', [], 1), answer('Sailing', [], 1),
      answer('Skiing', [], 0), answer('Figure skating', [], 1), answer('Ice hockey', [], 0),
      answer('Snowboarding', [], 1), answer('Curling', [], 1), answer('Wrestling', [], 0),
      answer('Boxing', [], 0), answer('Taekwondo', [], 1)
    ]
  }
];


function makePartyTopic(id, category, prompt, names, sourceId) {
  const source = sourceId ? Q.find(item => item.id === sourceId) : null;
  const seen = new Set();
  const answers = names.map((name, index) => {
    const key = normaliseAnswer(name);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const existing = source && source.answers.find(entry =>
      [entry.name].concat(entry.aliases || []).some(alias => normaliseAnswer(alias) === key)
    );
    return existing || answer(name, [], index < 6 ? 0 : index < 12 ? 1 : index < 18 ? 2 : 3);
  }).filter(Boolean);
  if (answers.length < 3) return null;
  return {
    id, topicId: id, domain: (source && source.domain) || 'geography',
    category, prompt, note: 'Think of a familiar example. Common answers from around the world count.',
    source: 'HUMANITY curated Globe Rush question bank', answers
  };
}
const fromPartyBase = (id, category, prompt, sourceId, names) =>
  makePartyTopic(id, category, prompt, names, sourceId);

const PARTY_EXTRA_QUESTIONS = [
  makePartyTopic("north-america-countries","Countries in North America","Name a country in North America",["Canada","United States","Mexico","Guatemala","Belize","Honduras","El Salvador","Nicaragua","Costa Rica","Panama","Cuba","Jamaica","Haiti","Dominican Republic","The Bahamas","Barbados","Trinidad and Tobago","Grenada","Saint Lucia","Antigua and Barbuda","Dominica","Saint Kitts and Nevis","Saint Vincent and the Grenadines"]),
  makePartyTopic("central-america-countries","Countries in Central America","Name a country in Central America",["Belize","Guatemala","Honduras","El Salvador","Nicaragua","Costa Rica","Panama"]),
  makePartyTopic("caribbean-countries","Countries in the Caribbean","Name a country in the Caribbean",["Cuba","Jamaica","Haiti","Dominican Republic","The Bahamas","Barbados","Trinidad and Tobago","Grenada","Saint Lucia","Antigua and Barbuda","Dominica","Saint Kitts and Nevis","Saint Vincent and the Grenadines"]),
  makePartyTopic("oceania-countries","Countries in Oceania","Name a country in Oceania",["Australia","New Zealand","Papua New Guinea","Fiji","Samoa","Tonga","Vanuatu","Solomon Islands","Kiribati","Tuvalu","Nauru","Palau","Federated States of Micronesia","Marshall Islands"]),
  fromPartyBase("southeast-asia-countries","Countries in Southeast Asia","Name a country in Southeast Asia","asia-countries",["Indonesia","Malaysia","Singapore","Thailand","Vietnam","Philippines","Cambodia","Laos","Myanmar","Brunei","Timor-Leste"]),
  fromPartyBase("east-asia-countries","Countries in East Asia","Name a country in East Asia","asia-countries",["China","Japan","Mongolia","North Korea","South Korea"]),
  fromPartyBase("northern-europe-countries","Countries in Northern Europe","Name a country in Northern Europe","europe-countries",["Denmark","Sweden","Norway","Finland","Iceland","Estonia","Latvia","Lithuania","Ireland","United Kingdom"]),
  fromPartyBase("southern-europe-countries","Countries in Southern Europe","Name a country in Southern Europe","europe-countries",["Italy","Spain","Portugal","Greece","Malta","Croatia","Slovenia","Albania","Montenegro","Serbia","Bosnia and Herzegovina","North Macedonia","Andorra","San Marino","Vatican City"]),
  fromPartyBase("western-europe-countries","Countries in Western Europe","Name a country in Western Europe","europe-countries",["France","Germany","Belgium","Netherlands","Luxembourg","Switzerland","Austria","Liechtenstein","Monaco"]),
  fromPartyBase("middle-east-countries","Countries in the Middle East","Name a country in the Middle East","asia-countries",["Saudi Arabia","United Arab Emirates","Qatar","Kuwait","Bahrain","Oman","Yemen","Jordan","Iraq","Iran","Israel","Lebanon","Syria","Palestine"]),
  fromPartyBase("southern-africa-countries","Countries in Southern Africa","Name a country in Southern Africa","africa-countries",["South Africa","Namibia","Botswana","Lesotho","Eswatini","Zimbabwe","Zambia","Mozambique","Malawi","Angola"]),
  fromPartyBase("west-africa-countries","Countries in West Africa","Name a country in West Africa","africa-countries",["Nigeria","Ghana","Senegal","Mali","Guinea","Benin","Togo","Liberia","Sierra Leone","Niger","Burkina Faso","Ivory Coast","Gambia","Mauritania","Cabo Verde","Guinea-Bissau"]),
  fromPartyBase("east-africa-countries","Countries in East Africa","Name a country in East Africa","africa-countries",["Kenya","Tanzania","Uganda","Rwanda","Burundi","Ethiopia","Somalia","South Sudan","Sudan","Eritrea","Djibouti","Madagascar","Comoros","Mauritius","Seychelles"]),
  fromPartyBase("european-capitals","Capital cities in Europe","Name a capital city in Europe","capital-cities",["Amsterdam","Berlin","Paris","Rome","Madrid","Lisbon","London","Vienna","Prague","Athens","Brussels","Copenhagen","Stockholm","Oslo","Helsinki","Warsaw","Budapest","Bern","Reykjavík","Kyiv"]),
  fromPartyBase("african-capitals","Capital cities in Africa","Name a capital city in Africa","capital-cities",["Accra","Addis Ababa","Algiers","Cairo","Dakar","Kigali","Nairobi","Rabat","Tunis","Abuja","Pretoria"]),
  fromPartyBase("asian-capitals","Capital cities in Asia","Name a capital city in Asia","capital-cities",["Tokyo","Seoul","Beijing","Bangkok","Hanoi","Jakarta","Singapore","Manila","Kuala Lumpur","New Delhi","Islamabad","Kathmandu","Abu Dhabi","Riyadh","Taipei","Tashkent"]),
  fromPartyBase("american-capitals","Capital cities in the Americas","Name a capital city in North or South America","capital-cities",["Ottawa","Buenos Aires","Brasília","Lima","Santiago","Bogotá","Quito","Montevideo","Caracas","Havana","Mexico City"]),
  fromPartyBase("european-major-cities","Major cities in Europe","Name a major city in Europe","major-cities",["London","Paris","Madrid","Barcelona","Berlin","Rome","Amsterdam","Vienna","Prague","Athens","Lisbon","Istanbul"]),
  fromPartyBase("asian-major-cities","Major cities in Asia","Name a major city in Asia","major-cities",["Tokyo","Seoul","Beijing","Shanghai","Bangkok","Singapore","Jakarta","Manila","Mumbai","Delhi","Dubai","Hong Kong","Hanoi"]),
  fromPartyBase("african-major-cities","Major cities in Africa","Name a major city in Africa","major-cities",["Cairo","Lagos","Johannesburg","Nairobi","Accra","Casablanca","Addis Ababa","Dakar","Marrakech"]),
  fromPartyBase("american-major-cities","Major cities in North or South America","Name a major city in the Americas","major-cities",["New York City","Los Angeles","Chicago","Toronto","Vancouver","Mexico City","São Paulo","Rio de Janeiro","Buenos Aires","Lima","Santiago"]),
  makePartyTopic("oceania-major-cities","Major cities in Oceania","Name a major city in Oceania",["Sydney","Melbourne","Brisbane","Perth","Auckland","Wellington","Adelaide"]),
  fromPartyBase("european-rivers","Rivers in Europe","Name a major river in Europe","world-rivers",["Danube","Rhine","Volga","Thames","Seine","Loire","Po River","Dnieper"]),
  fromPartyBase("african-rivers","Rivers in Africa","Name a major river in Africa","world-rivers",["Nile","Congo River","Niger River","Zambezi"]),
  fromPartyBase("asian-rivers","Rivers in Asia","Name a major river in Asia","world-rivers",["Yangtze","Yellow River","Ganges","Mekong","Indus","Euphrates","Tigris","Lena","Ob River"]),
  fromPartyBase("american-rivers","Rivers in the Americas","Name a major river in North or South America","world-rivers",["Amazon River","Mississippi","Paraná","Orinoco","Colorado River","Yukon River"]),
  fromPartyBase("european-mountains","Mountains in Europe","Name a famous mountain in Europe","mountains",["Mont Blanc","Matterhorn","Mount Elbrus","Mount Etna","Mount Vesuvius","Mount Ararat","Eiger","Jungfrau","Ben Nevis"]),
  fromPartyBase("african-mountains","Mountains in Africa","Name a famous mountain in Africa","mountains",["Kilimanjaro","Table Mountain","Mount Kenya","Mount Meru","Mount Toubkal"]),
  fromPartyBase("asian-mountains","Mountains in Asia","Name a famous mountain in Asia","mountains",["Mount Everest","K2","Mount Fuji","Puncak Jaya","Mount Ararat","Mauna Kea"]),
  fromPartyBase("american-mountains","Mountains in the Americas","Name a famous mountain in North or South America","mountains",["Denali","Aconcagua","Mount Rainier","Mount Roraima","Mount Whitney"]),
  fromPartyBase("mediterranean-islands","Islands in the Mediterranean","Name an island in the Mediterranean Sea","islands",["Sicily","Sardinia","Corsica","Crete","Cyprus"]),
  fromPartyBase("caribbean-islands","Islands in the Caribbean","Name an island in the Caribbean","islands",["Cuba","Hispaniola","Jamaica"]),
  fromPartyBase("pacific-islands","Islands in the Pacific Ocean","Name an island in the Pacific Ocean","islands",["Borneo","New Guinea","Honshu","Hokkaido","Tasmania","Sakhalin","Luzon","Mindanao","Easter Island"]),
  fromPartyBase("north-american-lakes","Lakes in North America","Name a major lake in North America","lakes",["Lake Superior","Lake Huron","Lake Michigan","Lake Ontario","Lake Erie","Lake Tahoe","Great Salt Lake","Lake Winnipeg"]),
  fromPartyBase("european-lakes","Lakes in Europe","Name a major lake in Europe","lakes",["Lake Ladoga","Lake Onega","Lake Geneva","Lake Como"]),
  fromPartyBase("african-lakes","Lakes in Africa","Name a major lake in Africa","lakes",["Lake Victoria","Lake Tanganyika","Lake Malawi","Lake Chad"]),
  fromPartyBase("african-deserts","Deserts in Africa","Name a desert in Africa","deserts",["Sahara","Kalahari Desert","Namib Desert"]),
  fromPartyBase("asian-deserts","Deserts in Asia","Name a desert in Asia","deserts",["Gobi Desert","Arabian Desert","Thar Desert","Karakum Desert","Kyzylkum Desert","Taklamakan Desert","Syrian Desert"]),
  fromPartyBase("north-american-deserts","Deserts in North America","Name a desert in North America","deserts",["Mojave Desert","Sonoran Desert","Chihuahuan Desert"]),
  fromPartyBase("south-american-deserts","Deserts in South America","Name a desert in South America","deserts",["Atacama Desert","Patagonian Desert"]),
  fromPartyBase("european-seas","Seas in Europe","Name a sea in or around Europe","seas",["Mediterranean Sea","Baltic Sea","Black Sea","North Sea","Aegean Sea","Adriatic Sea","Ionian Sea"]),
  fromPartyBase("asian-seas","Seas in Asia","Name a sea in Asia","seas",["Arabian Sea","South China Sea","Sea of Japan","Bering Sea","Red Sea","Coral Sea"]),
  fromPartyBase("european-landmarks","Landmarks in Europe","Name a famous landmark in Europe","world-landmarks",["Eiffel Tower","Colosseum","Acropolis of Athens","Stonehenge","Sagrada Familia","Petra","Hagia Sophia"]),
  fromPartyBase("asian-landmarks","Landmarks in Asia","Name a famous landmark in Asia","world-landmarks",["Great Wall of China","Taj Mahal","Angkor Wat","Burj Khalifa","Hagia Sophia","Petra"]),
  fromPartyBase("american-landmarks","Landmarks in the Americas","Name a famous landmark in North or South America","world-landmarks",["Machu Picchu","Christ the Redeemer","Statue of Liberty","Mount Rushmore","Chichen Itza","Golden Gate Bridge"]),
  makePartyTopic("african-landmarks","Landmarks in Africa","Name a famous landmark in Africa",["Pyramids of Giza","Great Sphinx of Giza","Table Mountain","Victoria Falls","Mount Kilimanjaro","Robben Island","Lalibela Rock Churches"]),
  makePartyTopic("world-waterfalls","Famous waterfalls","Name a famous waterfall in the world",["Niagara Falls","Victoria Falls","Iguazu Falls","Angel Falls","Yosemite Falls","Gullfoss","Rhine Falls","Dettifoss","Kaieteur Falls","Plitvice Waterfalls"]),
  makePartyTopic("famous-bridges","Famous bridges","Name a famous bridge in the world",["Golden Gate Bridge","Tower Bridge","Brooklyn Bridge","Sydney Harbour Bridge","Rialto Bridge","London Bridge","Charles Bridge","Millau Viaduct","Akashi Kaikyo Bridge"]),
  makePartyTopic("famous-volcanoes","Famous volcanoes","Name a famous volcano in the world",["Mount Fuji","Mount Etna","Mount Vesuvius","Krakatoa","Mauna Loa","Mount St. Helens","Kilimanjaro","Eyjafjallajökull","Mount Pinatubo"]),
  fromPartyBase("european-dishes","Dishes from Europe","Name a well-known dish from Europe","popular-dishes",["Pizza","Paella","Moussaka","Pierogi","Goulash","Fish and chips","Ratatouille","Gnocchi","Sauerbraten"]),
  fromPartyBase("asian-dishes","Dishes from Asia","Name a well-known dish from Asia","popular-dishes",["Sushi","Ramen","Pho","Pad Thai","Biryani","Kimchi jjigae","Bibimbap","Rendang","Laksa","Curry"]),
  fromPartyBase("african-dishes","Dishes from Africa","Name a well-known dish from Africa","popular-dishes",["Jollof rice","Couscous","Tagine","Feijoada","Curry"]),
  fromPartyBase("american-dishes","Dishes from North or South America","Name a well-known dish from the Americas","popular-dishes",["Pizza","Ceviche","Feijoada","Arepas","Mole poblano","Gumbo","Poutine"]),
  fromPartyBase("european-snacks","Snacks from Europe","Name a popular snack from Europe","popular-snacks",["Pretzel","Churros","Poutine","Arancini","Börek","Bruschetta","Scotch egg","Kroket"]),
  fromPartyBase("asian-snacks","Snacks from Asia","Name a popular snack from Asia","popular-snacks",["Samosa","Spring roll","Falafel","Takoyaki","Onigiri","Pani puri","Dumplings","Kimbap","Pocky","Edamame"]),
  makePartyTopic("oceania-capitals","Capital cities in Oceania","Name a capital city in Oceania",["Canberra","Wellington","Suva","Apia","Nukuʻalofa","Port Vila","Honiara"]),
  fromPartyBase("oceans","Oceans","Name an ocean in the world","seas",["Pacific Ocean","Atlantic Ocean","Indian Ocean","Arctic Ocean","Southern Ocean"])
].filter(Boolean);

function buildPartyQuestionPool() {
  const topics = Q.concat(PARTY_EXTRA_QUESTIONS);
  const pool = [];
  for (const topic of topics) {
    const subject = topic.prompt.replace(/^Name\s+/i, '').replace(/\.$/, '');
    const articleFree = subject.replace(/^(a|an|the)\s+/i, '');
    const prompts = [
      topic.prompt,
      'Can you name ' + subject + '?',
      'Tell us the name of ' + subject + '.',
      'Which ' + articleFree + ' can you name?'
    ];
    prompts.forEach((prompt, index) => pool.push({
      ...topic,
      id: 'rush-' + topic.id + '-v' + (index + 1),
      topicId: topic.id,
      prompt,
      source: 'HUMANITY curated Globe Rush question bank'
    }));
  }
  return pool;
}

const PARTY_QUESTIONS = buildPartyQuestionPool();
if (PARTY_QUESTIONS.length < 200) {
  throw new Error('The Globe Rush question bank must contain at least 200 accessible questions.');
}
function listPartyQuestionBank() {
  return PARTY_QUESTIONS.map(item => ({
    id: item.id, topicId: item.topicId, domain: item.domain,
    category: item.category, prompt: item.prompt, answerCount: item.answers.length
  }));
}

const QUESTION_BY_ID = new Map(Q.map(item => [item.id, item]));

function hashSeed(value) {
  return crypto.createHash('sha256').update(String(value)).digest().readUInt32BE(0);
}

function seededShuffle(items, seed) {
  return [...items].map(item => ({
    item,
    key: hashSeed(seed + ':' + item.id)
  })).sort((a, b) => a.key - b.key).map(entry => entry.item);
}

function classifyDailyQuestion(item) {
  if (item.type === 'flags') return 'flags';
  if (item.type === 'currency') return 'currency';
  if (item.type === 'culture' || item.domain === 'culture') return 'culture';
  if (item.type === 'cities' || /capital|cities/i.test(item.category)) return 'cities';
  if (item.type === 'nature' || /river|mountain|island|lake|sea|ocean|desert|park/i.test(item.category)) return 'nature';
  if (item.type === 'landmarks' || /landmark|heritage/i.test(item.category)) return 'landmarks';
  if (/countries|country/i.test(item.category)) return 'countries';
  return item.domain === 'geography' ? 'geography' : 'culture';
}

function generateDailyChallenge(date, excludedQuestionIds = []) {
  const excluded = new Set(Array.isArray(excludedQuestionIds) ? excludedQuestionIds : []);
  const selected = [];
  const pools = ['flags', 'countries', 'cities', 'nature', 'landmarks', 'geography', 'culture'];
  for (const poolName of pools) {
    let pool = Q.filter(item => {
      const type = classifyDailyQuestion(item);
      return (type === 'currency' ? 'countries' : type) === poolName;
    });
    let fresh = pool.filter(item => !excluded.has(item.id) && !selected.some(chosen => chosen.id === item.id));
    if (!fresh.length) fresh = pool.filter(item => !selected.some(chosen => chosen.id === item.id));
    if (!fresh.length && poolName !== 'culture') {
      pool = Q.filter(item => item.domain === 'geography');
      fresh = pool.filter(item => !excluded.has(item.id) && !selected.some(chosen => chosen.id === item.id));
    }
    if (!fresh.length) {
      pool = Q.filter(item => !selected.some(chosen => chosen.id === item.id));
      fresh = pool;
    }
    if (fresh.length) selected.push(seededShuffle(fresh, 'HUMANITY-' + poolName.toUpperCase() + '-' + date)[0]);
  }
  const ordered = seededShuffle(selected, 'HUMANITY-ORDER-' + date);

  return {
    date,
    title: 'Atlas Daily',
    questions: ordered.map((item, index) => ({
      id: item.id,
      slot: index,
      domain: item.domain,
      type: classifyDailyQuestion(item),
      visual: item.visual || null,
      category: item.category,
      prompt: item.prompt,
      note: item.note,
      source: item.source,
      hints: item.answers
        .slice()
        .sort((a, b) => a.rarity - b.rarity)
        .slice(0, 3)
        .map(entry => entry.name),
      answers: item.answers
    }))
  };
}

function publicQuestion(question, index) {
  return {
    id: question.id,
    index,
    type: question.type || classifyDailyQuestion(question),
    visual: question.visual || null,
    category: question.category,
    prompt: question.prompt,
    note: question.note,
    answerCount: question.answers.length,
    seconds: 25
  };
}

function matchAnswer(question, rawAnswer) {
  const target = normaliseAnswer(rawAnswer);
  if (!target || target.length > 80) return null;

  for (const entry of question.answers || []) {
    const names = [entry.name].concat(entry.aliases || []);
    if (names.some(name => normaliseAnswer(name) === target)) {
      return {
        key: normaliseAnswer(entry.name),
        name: entry.name,
        rarity: entry.rarity,
        level: LEVEL_NAMES[entry.rarity],
        points: POINTS_BY_LEVEL[entry.rarity],
        source: entry.source || question.source || 'HUMANITY curated dataset'
      };
    }
  }
  return null;
}

function pointsForUsage(entry, answerCount, totalAnswers) {
  if (!entry) return 0;
  if (!Number.isFinite(totalAnswers) || totalAnswers < 20 || !Number.isFinite(answerCount)) {
    return POINTS_BY_LEVEL[entry.rarity];
  }
  const share = answerCount / Math.max(1, totalAnswers);
  const popularityLevel = share >= 0.30 ? 0
    : share >= 0.20 ? 1
    : share >= 0.10 ? 2
    : share >= 0.05 ? 3
    : share >= 0.02 ? 4 : 5;
  const finalLevel = Math.max(0, Math.min(5, Math.round((entry.rarity + popularityLevel) / 2)));
  return POINTS_BY_LEVEL[finalLevel];
}

function getQuestion(id) {
  return QUESTION_BY_ID.get(id) || PARTY_QUESTIONS.find(item => item.id === id) || null;
}

function partyThemeMatches(item, theme) {
  const topicId = String(item.topicId || '').toLowerCase();
  if (!theme || theme === 'all') return true;
  if (theme === 'countries') return /countries/.test(topicId);
  if (theme === 'cities') return /capital-cities|major-cities/.test(topicId);
  if (theme === 'nature') return /world-rivers|mountains|islands|lakes|seas|deserts/.test(topicId);
  if (theme === 'landmarks') return /world-landmarks/.test(topicId);
  if (theme === 'culture') return /popular-dishes|popular-snacks|languages/.test(topicId);
  return true;
}

function partyDifficultyMatches(item, difficulty) {
  const count = Array.isArray(item.answers) ? item.answers.length : 0;
  if (difficulty === 'easy') return count >= 16;
  if (difficulty === 'hard') return count > 0 && count <= 12;
  return true;
}

function getPartyQuestion(excludedIds, options = {}) {
  const excluded = excludedIds instanceof Set
    ? new Set(excludedIds)
    : new Set(Array.isArray(excludedIds) ? excludedIds : (excludedIds ? [excludedIds] : []));
  const excludedTopics = new Set(
    PARTY_QUESTIONS.filter(item => excluded.has(item.id)).map(item => item.topicId)
  );
  const themePool = PARTY_QUESTIONS.filter(item => partyThemeMatches(item, options.categoryTheme || 'all'));
  const difficultyPool = themePool.filter(item => partyDifficultyMatches(item, options.difficulty || 'normal'));
  // A deliberately narrow theme/difficulty combination should never block a match
  // when the curated answer bank does not contain enough questions for another rotation.
  const sourcePool = difficultyPool.length ? difficultyPool : themePool.length ? themePool : PARTY_QUESTIONS;
  let eligible = sourcePool.filter(item =>
    !excluded.has(item.id) && !excludedTopics.has(item.topicId)
  );
  if (!eligible.length) {
    const lastId = Array.isArray(excludedIds)
      ? excludedIds[excludedIds.length - 1]
      : (excludedIds instanceof Set ? Array.from(excludedIds).pop() : excludedIds);
    const lastTopic = PARTY_QUESTIONS.find(item => item.id === lastId)?.topicId;
    eligible = sourcePool.filter(item => item.topicId !== lastTopic);
  }
  const pool = eligible.length ? eligible : sourcePool;
  return pool[crypto.randomInt(0, pool.length)];
}

function listQuestionBank() {
  return Q.map(item => ({
    id: item.id,
    domain: item.domain,
    category: item.category,
    type: item.type || classifyDailyQuestion(item),
    visual: item.visual || null,
    prompt: item.prompt,
    answerCount: item.answers.length,
    source: item.source
  }));
}

module.exports = {
  POINTS_BY_LEVEL,
  LEVEL_NAMES,
  normaliseAnswer,
  generateDailyChallenge,
  publicQuestion,
  matchAnswer,
  pointsForUsage,
  getQuestion,
  getPartyQuestion,
  listQuestionBank,
  listPartyQuestionBank,
  partyQuestionCount: PARTY_QUESTIONS.length
};
