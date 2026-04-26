import { Type, FunctionDeclaration } from "@google/genai";

export const MENU_PRICES: Record<string, number> = {
  "Single": 645,
  "Single Choice": 665,
  "Single Without Kabab": 585,
  "Special Choice": 845,
  "Pulao": 335,
  "Pulao Kabab": 445,
  "Krispo Burger": 610,
  "Chicken Burger": 510,
  "Krispo Burger Fries Combo": 810,
  "Chicken Burger Fries Combo": 705,
  "French Fries Medium": 275,
  "Krispo Wings 6 pcs": 449,
  "Kheer Cup": 210,
  "Zarda Cup": 195,
  "Soft Drink 500ml": 140,
  "Water 500ml": 75
};

export const systemInstruction = `You are the voice-ordering assistant for a Savour Foods kiosk in Islamabad.
Your ONLY role is to help users build their order using the official Menu. 

Menu Structure:
- Pulao: Single (645), Single Choice (665), Special Choice (845), Pulao Kabab (445), Single Without Kabab (585).
- Burgers: Krispo Burger (610), Chicken Burger (510), Zinger Burger (650), Double Patty (890).
- Fried: Krispo Wings (4/6/10 pcs), nuggets, crispy chicken pieces.
- Deals: My Deal (999), Student Deal (699), Lunch Deal (745).
- Breakfast: Halwa Puri (420), Chana Plate (220).
- Desserts: Kheer Cup (210), Zarda Cup (195).
- Beverages: Water, Soft Drinks (Cans/Bottles).

Language Support:
- Understand and speak English, Urdu, and Roman Urdu (Urdu written in English alphabets).
- "Aik special choice pulao aur aik Pepsi can" -> Add 1 Special Choice, 1 Soft Drink Can Pepsi.

Guidelines:
1. Greet politely.
2. Use tools to add/remove items.
3. Be EXTREMELY concise. Confirm with 2-3 words.
4. Don't mention GST unless asked (it's 15% added at the end).
5. Once they confirm, call confirm_order.
`;

export const add_item: FunctionDeclaration = {
  name: "add_item",
  description: "Add an item to the shopping cart. Map the user's request to the closest exact menu item name.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      item_name: { type: Type.STRING, description: "Exact name of the item from the menu." },
      quantity: { type: Type.INTEGER, description: "Quantity of this item to add." },
      price: { type: Type.INTEGER, description: "The unit price of the item from the menu." }
    },
    required: ["item_name", "quantity", "price"]
  }
};

export const remove_item: FunctionDeclaration = {
  name: "remove_item",
  description: "Remove an item from the shopping cart completely.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      item_name: { type: Type.STRING }
    },
    required: ["item_name"]
  }
};

export const clear_cart: FunctionDeclaration = {
  name: "clear_cart",
  description: "Remove everything from the cart.",
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

export const confirm_order: FunctionDeclaration = {
  name: "confirm_order",
  description: "Finalize the order after the customer confirms they are done.",
  parameters: {
    type: Type.OBJECT,
    properties: {}
  }
};

export const allTools = [add_item, remove_item, clear_cart, confirm_order];
