// The built-in food list for Manual Entry: common Indian foods and dishes with calories and macros
// per 100 g (per 100 ml for drinks), so typing a food and its amount fills in the numbers.
//
// The values are typical figures for home-style Indian cooking, compiled from published food
// composition references (IFCT 2017 / NIN for Indian foods, USDA FoodData Central for the rest).
// Cooked dishes vary with the recipe (oil, ghee, coconut), so every number stays editable in the app.
// REVIEW BEFORE LAUNCH: have a nutritionist check this table; lib/foods.ts tests only check that each
// row's calories roughly agree with its macros, not that the figures are right.
//
// A row: [name, kcal, protein g, carbs g, fat g, options]. `piece`: grams in one typical piece
// (roti, idli, egg…) so the amount can be given in pieces; `liquid`: measured in ml; `aka`: other
// names people search by.
type Row = [string, number, number, number, number, { piece?: number; liquid?: boolean; aka?: string[] }?];

const ROWS: Row[] = [
  // Breads
  ["Roti / chapati", 264, 8.7, 50, 3.7, { piece: 40, aka: ["phulka", "chapathi", "fulka"] }],
  ["Chapati with ghee", 300, 8, 48, 8.5, { piece: 45 }],
  ["Plain paratha", 326, 6.4, 45, 13, { piece: 80, aka: ["parantha"] }],
  ["Aloo paratha", 260, 5.5, 36, 10.5, { piece: 120, aka: ["potato paratha"] }],
  ["Puri", 360, 6.5, 44, 18, { piece: 25, aka: ["poori"] }],
  ["Naan", 290, 9, 50, 5.5, { piece: 90 }],
  ["Butter naan", 320, 8.5, 48, 10, { piece: 100 }],
  ["Bhatura", 350, 7, 46, 15, { piece: 80, aka: ["bhature"] }],
  ["Thepla", 300, 8, 42, 11, { piece: 45 }],
  ["White bread", 265, 9, 49, 3.2, { piece: 25, aka: ["bread slice"] }],
  ["Brown bread", 247, 13, 41, 3.4, { piece: 28, aka: ["wheat bread"] }],
  ["Pav", 280, 8.5, 52, 4, { piece: 40, aka: ["bun"] }],

  // Rice
  ["Steamed rice", 130, 2.7, 28, 0.3, { aka: ["white rice", "plain rice", "boiled rice", "chawal"] }],
  ["Brown rice", 112, 2.6, 23.5, 0.9],
  ["Jeera rice", 160, 3, 28, 4],
  ["Veg pulao", 150, 3.2, 25, 4.2, { aka: ["pulav"] }],
  ["Veg biryani", 165, 3.5, 25, 5.5],
  ["Chicken biryani", 180, 9, 21, 6.5],
  ["Mutton biryani", 200, 9.5, 20, 9],
  ["Egg biryani", 170, 6.5, 22, 6],
  ["Curd rice", 120, 3.5, 18, 3.6, { aka: ["thayir sadam", "dahi chawal"] }],
  ["Lemon rice", 165, 3, 27, 5],
  ["Tamarind rice", 180, 3, 30, 5.5, { aka: ["puliyogare", "puliodarai"] }],
  ["Khichdi", 120, 4.5, 20, 2.5, { aka: ["khichri"] }],
  ["Veg fried rice", 165, 3.5, 26, 5],
  ["Bisi bele bath", 140, 4.5, 21, 4],

  // South Indian
  ["Idli", 130, 4, 27, 0.4, { piece: 40 }],
  ["Plain dosa", 165, 3.9, 29, 3.7, { piece: 80, aka: ["dosai"] }],
  ["Masala dosa", 190, 4, 27, 7.5, { piece: 160 }],
  ["Rava dosa", 200, 4, 28, 8, { piece: 90 }],
  ["Uttapam", 160, 4.5, 26, 4.5, { piece: 120, aka: ["uthappam"] }],
  ["Medu vada", 290, 10, 28, 15.5, { piece: 50, aka: ["vada", "uzhunnu vada"] }],
  ["Upma", 140, 3.5, 21, 4.8, { aka: ["uppittu"] }],
  ["Ven pongal", 150, 4.5, 20, 5.5, { aka: ["khara pongal"] }],
  ["Sambar", 65, 3.2, 8.5, 2],
  ["Rasam", 30, 1, 4.5, 0.9],
  ["Coconut chutney", 190, 2.5, 7, 17],
  ["Tomato chutney", 100, 1.5, 9, 6.5],
  ["Appam", 150, 2.5, 28, 3, { piece: 50 }],
  ["Puttu", 160, 3.5, 33, 1.5],
  ["Idiyappam", 140, 2.5, 31, 0.5, { piece: 40, aka: ["string hoppers"] }],
  ["Ragi mudde", 110, 2.5, 24, 0.5, { aka: ["ragi ball", "ragi sangati"] }],

  // Breakfast and light meals
  ["Poha", 160, 3, 26, 5, { aka: ["kanda poha", "aval"] }],
  ["Sabudana khichdi", 200, 1.5, 35, 6.5],
  ["Besan chilla", 200, 9, 22, 8.5, { piece: 70, aka: ["besan cheela"] }],
  ["Moong dal chilla", 160, 9, 20, 5, { piece: 70, aka: ["pesarattu", "moong cheela"] }],
  ["Dhokla", 160, 6.5, 22, 5.5, { piece: 30 }],
  ["Oats porridge with milk", 110, 4.5, 15, 3.5, { aka: ["oatmeal"] }],
  ["Oats (dry)", 389, 16.9, 66, 6.9],
  ["Cornflakes", 357, 7.5, 84, 0.4],
  ["Muesli", 370, 10, 66, 6],
  ["Quinoa (cooked)", 120, 4.4, 21, 1.9],

  // Dals and legumes
  ["Dal tadka", 115, 6, 14, 4, { aka: ["dal", "daal", "toor dal", "arhar dal"] }],
  ["Dal fry", 125, 6, 14, 5],
  ["Dal makhani", 160, 6, 14, 9],
  ["Moong dal (cooked)", 105, 7, 16, 1.4, { aka: ["yellow dal"] }],
  ["Masoor dal (cooked)", 110, 7.5, 17, 1.2],
  ["Chana dal (cooked)", 130, 7, 19, 3],
  ["Rajma curry", 125, 6, 16, 4, { aka: ["rajma", "kidney beans curry"] }],
  ["Chole", 150, 6.5, 18, 6, { aka: ["chana masala", "chickpea curry"] }],
  ["Kadhi", 90, 3, 7, 5.5],
  ["Boiled chickpeas", 164, 8.9, 27, 2.6, { aka: ["kabuli chana", "chana"] }],
  ["Boiled rajma", 127, 8.7, 22.8, 0.5, { aka: ["kidney beans"] }],
  ["Moong sprouts", 30, 3, 4.1, 0.2, { aka: ["sprouts"] }],
  ["Sprouts salad", 70, 4.5, 10, 1.5],
  ["Soya chunks (dry)", 345, 52, 33, 0.5, { aka: ["meal maker", "nutrela"] }],
  ["Soya chunks curry", 140, 11, 9, 6.5],
  ["Tofu", 76, 8, 1.9, 4.8],
  ["Roasted chana", 369, 22.5, 58, 5.2, { aka: ["bhuna chana", "pottukadalai"] }],

  // Vegetable dishes
  ["Paneer butter masala", 230, 8, 9, 18.5, { aka: ["paneer makhani"] }],
  ["Palak paneer", 165, 8, 6, 12.5],
  ["Kadai paneer", 200, 9, 8, 15],
  ["Matar paneer", 170, 7.5, 9, 12],
  ["Paneer bhurji", 240, 13, 6, 18.5],
  ["Paneer tikka", 230, 15, 6, 16.5],
  ["Aloo gobi", 100, 2.5, 11, 5.5],
  ["Jeera aloo", 120, 2, 16, 5.5, { aka: ["aloo sabzi", "potato fry"] }],
  ["Bhindi masala", 110, 2.2, 9, 7.5, { aka: ["bhindi fry", "okra", "vendakkai"] }],
  ["Baingan bharta", 90, 2, 8, 6, { aka: ["brinjal"] }],
  ["Mixed veg curry", 95, 2.5, 9, 5.5, { aka: ["sabzi", "veg curry"] }],
  ["Cabbage poriyal", 75, 2, 7, 4.5, { aka: ["cabbage sabzi"] }],
  ["Beans poriyal", 90, 2.5, 8, 5.5, { aka: ["beans sabzi"] }],
  ["Avial", 120, 2.5, 8, 9],
  ["Malai kofta", 230, 5, 14, 17],
  ["Veg kurma", 140, 3, 11, 9.5, { aka: ["korma"] }],
  ["Dum aloo", 140, 2.3, 15, 8],
  ["Pav bhaji (bhaji only)", 130, 2.8, 15, 6.5, { aka: ["bhaji"] }],

  // Eggs, chicken, meat and fish
  ["Boiled egg", 155, 13, 1.1, 11, { piece: 50, aka: ["egg", "anda"] }],
  ["Omelette", 180, 11, 2, 14, { piece: 60, aka: ["egg omelette"] }],
  ["Egg bhurji", 200, 12, 3, 15.5, { aka: ["scrambled eggs"] }],
  ["Egg curry", 150, 8, 5, 11],
  ["Chicken curry", 150, 14, 4, 9],
  ["Butter chicken", 215, 14, 6, 15],
  ["Chicken tikka", 150, 24, 3, 5],
  ["Tandoori chicken", 160, 25, 3, 5.5],
  ["Grilled chicken breast", 165, 31, 0, 3.6],
  ["Chicken breast (raw)", 120, 22.5, 0, 2.6],
  ["Chicken 65", 260, 19, 10, 16, { aka: ["fried chicken"] }],
  ["Mutton curry", 200, 15, 4, 14],
  ["Keema", 210, 16, 5, 14, { aka: ["mince"] }],
  ["Fish curry", 135, 14, 4, 7],
  ["Fish fry", 200, 19, 6, 11],
  ["Prawn curry", 130, 14, 5, 6, { aka: ["shrimp"] }],

  // Dairy
  ["Toned milk", 58, 3, 4.7, 3, { liquid: true, aka: ["milk"] }],
  ["Whole milk", 64, 3.2, 4.8, 3.6, { liquid: true, aka: ["full cream milk"] }],
  ["Skimmed milk", 35, 3.4, 5, 0.1, { liquid: true }],
  ["Curd", 61, 3.5, 4.7, 3.3, { aka: ["dahi", "yogurt", "thayir"] }],
  ["Greek yogurt", 59, 10, 3.6, 0.4],
  ["Buttermilk", 20, 1, 2, 0.8, { liquid: true, aka: ["chaas", "mor", "chhachh"] }],
  ["Sweet lassi", 90, 2.5, 14, 2.6, { liquid: true, aka: ["lassi"] }],
  ["Paneer", 265, 18.3, 1.2, 20.8, { aka: ["cottage cheese"] }],
  ["Cheese slice", 300, 18, 6, 23, { piece: 17, aka: ["cheese"] }],
  ["Ghee", 900, 0, 0, 100],
  ["Butter", 717, 0.9, 0.1, 81],
  ["Cooking oil", 884, 0, 0, 100, { aka: ["oil"] }],
  ["Whey protein", 400, 78, 8, 6, { piece: 30, aka: ["protein powder", "scoop"] }],

  // Tea, coffee and drinks
  ["Tea with milk and sugar", 45, 1.3, 6.5, 1.5, { liquid: true, aka: ["chai", "tea"] }],
  ["Coffee with milk and sugar", 50, 1.5, 7, 1.7, { liquid: true, aka: ["coffee", "filter coffee"] }],
  ["Black coffee", 2, 0.3, 0, 0, { liquid: true }],
  ["Coconut water", 19, 0.7, 3.7, 0.2, { liquid: true, aka: ["elaneer", "nariyal pani"] }],
  ["Orange juice", 45, 0.7, 10.4, 0.2, { liquid: true, aka: ["juice"] }],
  ["Sugarcane juice", 70, 0.2, 17.5, 0.1, { liquid: true }],
  ["Banana milkshake", 90, 2.8, 15, 2.5, { liquid: true, aka: ["milkshake", "shake"] }],
  ["Soft drink", 42, 0, 10.6, 0, { liquid: true, aka: ["cola", "soda"] }],
  ["Nimbu pani", 30, 0, 7.5, 0, { liquid: true, aka: ["lemonade", "lemon juice"] }],

  // Fruit
  ["Banana", 89, 1.1, 23, 0.3, { piece: 100, aka: ["kela"] }],
  ["Apple", 52, 0.3, 14, 0.2, { piece: 180 }],
  ["Orange", 47, 0.9, 12, 0.1, { piece: 130 }],
  ["Mango", 60, 0.8, 15, 0.4, { aka: ["aam"] }],
  ["Papaya", 43, 0.5, 11, 0.3],
  ["Guava", 68, 2.6, 14, 1, { piece: 100, aka: ["amrood"] }],
  ["Grapes", 69, 0.7, 18, 0.2],
  ["Watermelon", 30, 0.6, 7.2, 0.2],
  ["Pomegranate", 83, 1.7, 19, 1.2, { aka: ["anar"] }],
  ["Pineapple", 50, 0.5, 13, 0.1],
  ["Chikoo", 83, 0.4, 20, 1.1, { aka: ["sapota"] }],
  ["Dates", 282, 2.5, 75, 0.4, { piece: 8, aka: ["khajur"] }],
  ["Raisins", 299, 3.1, 79, 0.5, { aka: ["kishmish"] }],

  // Vegetables and salad
  ["Cucumber", 15, 0.7, 3.6, 0.1],
  ["Tomato", 18, 0.9, 3.9, 0.2, { piece: 100 }],
  ["Onion", 40, 1.1, 9.3, 0.1],
  ["Carrot", 41, 0.9, 10, 0.2],
  ["Boiled potato", 87, 1.9, 20, 0.1, { aka: ["potato", "aloo"] }],
  ["Boiled sweet potato", 76, 1.4, 18, 0.1, { aka: ["shakarkandi"] }],
  ["Green salad", 20, 1, 4, 0.2, { aka: ["salad"] }],
  ["Spinach", 23, 2.9, 3.6, 0.4, { aka: ["palak"] }],

  // Nuts and seeds
  ["Almonds", 579, 21, 22, 50, { piece: 1.2, aka: ["badam"] }],
  ["Cashews", 553, 18, 30, 44, { aka: ["kaju"] }],
  ["Roasted peanuts", 585, 24, 21, 50, { aka: ["peanuts", "groundnut", "moongphali"] }],
  ["Walnuts", 654, 15, 14, 65, { aka: ["akhrot"] }],
  ["Peanut butter", 588, 25, 20, 50],
  ["Chia seeds", 486, 17, 42, 31],
  ["Flax seeds", 534, 18, 29, 42, { aka: ["alsi"] }],
  ["Makhana (roasted)", 350, 9.7, 77, 0.1, { aka: ["fox nuts", "lotus seeds"] }],

  // Snacks and street food
  ["Samosa", 300, 5, 32, 17, { piece: 70 }],
  ["Kachori", 410, 7, 45, 22, { piece: 50 }],
  ["Onion pakora", 315, 8, 30, 18, { piece: 20, aka: ["pakoda", "bhaji", "bajji"] }],
  ["Vada pav", 290, 6.5, 40, 11.5, { piece: 150 }],
  ["Pani puri", 180, 3.5, 30, 5, { piece: 25, aka: ["golgappa", "puchka"] }],
  ["Bhel puri", 180, 4.5, 30, 5],
  ["Namkeen mixture", 520, 13, 45, 33, { aka: ["mixture", "chivda", "sev"] }],
  ["Murukku", 520, 9, 55, 29, { piece: 15, aka: ["chakli"] }],
  ["Khakhra", 400, 13, 60, 12, { piece: 15 }],
  ["Marie biscuits", 440, 7.5, 76, 11, { piece: 7, aka: ["biscuit"] }],
  ["Cream biscuits", 480, 5, 70, 20, { piece: 12 }],
  ["Potato chips", 536, 7, 53, 35, { aka: ["chips", "wafers"] }],
  ["Popcorn", 400, 12, 75, 6],
  ["Instant noodles (cooked)", 135, 3, 19, 5, { aka: ["maggi", "noodles"] }],
  ["Veg sandwich", 220, 6, 30, 8, { piece: 120, aka: ["sandwich"] }],
  ["Grilled cheese sandwich", 300, 11, 30, 15, { piece: 130 }],
  ["Veg burger", 240, 6, 32, 9.5, { piece: 150, aka: ["burger"] }],
  ["Cheese pizza", 266, 11, 33, 10, { piece: 100, aka: ["pizza"] }],
  ["French fries", 312, 3.4, 41, 15, { aka: ["fries"] }],
  ["Veg momos (steamed)", 160, 5, 26, 4, { piece: 30, aka: ["momos", "dumplings"] }],
  ["Chicken momos (steamed)", 175, 9, 20, 6.5, { piece: 30 }],
  ["Spring roll", 250, 5, 30, 12, { piece: 60 }],

  // Sweets
  ["Gulab jamun", 300, 4.5, 45, 11.5, { piece: 50 }],
  ["Rasgulla", 186, 4, 38, 1.8, { piece: 50, aka: ["rosogolla"] }],
  ["Jalebi", 410, 3, 65, 16, { piece: 25 }],
  ["Kheer", 140, 3.8, 20, 4.8, { aka: ["payasam", "payesh"] }],
  ["Gajar halwa", 230, 4, 30, 11, { aka: ["carrot halwa"] }],
  ["Sooji halwa", 320, 4, 45, 14, { aka: ["sheera", "kesari"] }],
  ["Besan ladoo", 450, 9, 55, 22, { piece: 35, aka: ["ladoo", "laddu"] }],
  ["Milk barfi", 400, 9, 55, 16, { piece: 30, aka: ["barfi", "burfi"] }],
  ["Vanilla ice cream", 207, 3.5, 24, 11, { aka: ["ice cream"] }],
  ["Dark chocolate", 546, 4.9, 61, 31],
  ["Milk chocolate", 535, 7.6, 59, 30, { aka: ["chocolate"] }],
  ["Sugar", 387, 0, 100, 0],
  ["Honey", 304, 0.3, 82, 0],
  ["Jaggery", 383, 0.4, 98, 0.1, { aka: ["gur", "vellam"] }],
];

export type FoodUnit = "g" | "ml" | "piece";
export type Food = {
  id: string;
  name: string;
  aka: string[];
  // Per 100 g, or per 100 ml for a drink
  per100: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  // Grams in one typical piece, when it is counted in pieces
  pieceG: number | null;
  liquid: boolean;
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const FOODS: Food[] = ROWS.map(([name, kcal, proteinG, carbsG, fatG, opts = {}]) => ({
  id: slug(name),
  name,
  aka: opts.aka ?? [],
  per100: { kcal, proteinG, carbsG, fatG },
  pieceG: opts.piece ?? null,
  liquid: opts.liquid === true,
}));
