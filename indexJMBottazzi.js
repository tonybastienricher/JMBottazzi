/**
 * Script d'indexation JMBottazzi (JSON Channable → Castafiore).
 * Métafields castapp : property.json + resolvers, namespace castapp.
 * Tour de doigt : 44–71 pour les bagues uniquement.
 * Mode test : TEST_CONFIG (ENABLED, MAX_PRODUCTS_TO_TEST, SKIP_ACTUAL_UPDATES, LOG_DETAILED_DATA, LOG_METAFIELDS).
 */
import { createAdminApiClient } from "@shopify/admin-api-client";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiVersion = "2025-04";
const storeDomain = "wallis-paris.myshopify.com";
const locationId = "gid://shopify/Location/66135490720"; // France
const pourcentage = 0.9;

const MAX_MEDIA_PER_PRODUCT = 10;
const TOUR_DE_DOIGT_MIN = 44;
const TOUR_DE_DOIGT_MAX = 71;

const TEST_CONFIG = {
  ENABLED: false, // true = mode test activé, false = mode production
  MAX_PRODUCTS_TO_TEST: 3, // Nombre maximum de produits à traiter en mode test
  SKIP_ACTUAL_UPDATES: true, // true = ne pas faire les vraies mises à jour, false = faire les mises à jour
  LOG_DETAILED_DATA: true, // true = afficher les données détaillées des produits
  LOG_METAFIELDS: true, // en mode test : afficher les métafields castapp qui seraient envoyés
};

let properties = null;

function loadProperties() {
  if (properties) return properties;
  const filePath = path.join(__dirname, "property.json");
  const raw = fs.readFileSync(filePath, "utf8");
  properties = JSON.parse(raw);
  return properties;
}

function normalizeForMatch(str) {
  if (typeof str !== "string") return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function resolveBrandName(text) {
  const prop = loadProperties();
  const normalized = normalizeForMatch(text);
  const found = prop.product.brands.find(
    (b) => b.active && (normalizeForMatch(b.name) === normalized || normalized.includes(normalizeForMatch(b.name)))
  );
  return found ? found.name : null;
}

function resolveMaterialNames(text) {
  const prop = loadProperties();
  const normalized = normalizeForMatch(text);
  const found = prop.product.materials.filter(
    (m) => m.active && normalized.includes(normalizeForMatch(m.name))
  );
  return found.length ? found.map((m) => m.name) : [];
}

function resolveGemNames(text) {
  const prop = loadProperties();
  if (!text || typeof text !== "string" || !text.trim()) return [];
  const normalized = normalizeForMatch(text);
  const found = prop.product.gems.filter(
    (g) => g.active && normalized.includes(normalizeForMatch(g.name))
  );
  return found.length ? found.map((g) => g.name) : [];
}

function resolveConditionName(text) {
  if (!text || typeof text !== "string" || !text.trim()) return null;
  const prop = loadProperties();
  const normalized = normalizeForMatch(text);
  const found = prop.product.conditions.find(
    (c) => c.active && (normalizeForMatch(c.name) === normalized || normalized.includes(normalizeForMatch(c.name)))
  );
  return found ? found.name : null;
}

function resolveGenreNames(text) {
  if (!text || typeof text !== "string" || !text.trim()) return [];
  const prop = loadProperties();
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const names = [];
  for (const part of parts) {
    const normalized = normalizeForMatch(part);
    const found = prop.product.genres.find(
      (g) => g.active && (normalizeForMatch(g.name) === normalized || normalized.includes(normalizeForMatch(g.name)))
    );
    if (found && !names.includes(found.name)) names.push(found.name);
  }
  if (names.length > 0) return names;
  const normalized = normalizeForMatch(text);
  const found = prop.product.genres.filter(
    (g) => g.active && normalized.includes(normalizeForMatch(g.name))
  );
  return found.length ? found.map((g) => g.name) : [];
}

function getModelListForType(typeName) {
  const prop = loadProperties();
  if (!typeName) return null;
  const n = normalizeForMatch(String(typeName));
  if (n.includes("bague")) return prop.product.models?.rings ?? null;
  if (n.includes("collier")) return prop.product.models?.necklaces ?? null;
  if (n.includes("bracelet")) return prop.product.styles?.bracelets ?? null;
  if (n.includes("boucle") && n.includes("oreille")) return prop.product.models?.earrings ?? null;
  if (n.includes("broche")) return prop.product.models?.broaches ?? null;
  if (n.includes("montre")) return prop.product.models?.watches ?? null;
  if (n.includes("pendentif")) return prop.product.styles?.pendants ?? null;
  return null;
}

function resolveModelName(typeName, modelLabel) {
  if (!modelLabel || typeof modelLabel !== "string" || !modelLabel.trim()) return null;
  const list = getModelListForType(typeName);
  if (!list || !Array.isArray(list)) return null;
  const normalized = normalizeForMatch(modelLabel);
  const found = list.find(
    (m) => m.active && (normalizeForMatch(m.name) === normalized || normalized.includes(normalizeForMatch(m.name)))
  );
  return found ? found.name : null;
}

function getModelMetafieldKey(typeName) {
  if (!typeName) return null;
  const n = normalizeForMatch(String(typeName));
  if (n.includes("bague")) return "ring_model";
  if (n.includes("collier")) return "necklace_model";
  if (n.includes("bracelet")) return "bracelet_model";
  if (n.includes("boucle") && n.includes("oreille")) return "earrings_model";
  if (n.includes("broche")) return "brooch_model";
  if (n.includes("montre")) return "watch_model";
  if (n.includes("pendentif")) return null;
  return null;
}

function parseYearRange(str) {
  if (!str || typeof str !== "string") return null;
  const match = str.match(/(\d{4})\s*-\s*(\d{4})/) || str.match(/(\d{4})\s*-\s*(\d{2})/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  let end = parseInt(match[2], 10);
  if (end < 100) end += 1900;
  return { start, end };
}

function resolveEraName(text) {
  if (!text || typeof text !== "string" || !text.trim()) return null;
  const prop = loadProperties();
  const eras = prop.product.eras;
  if (!eras || !Array.isArray(eras)) return null;
  const normalizedInput = normalizeForMatch(text);
  const exact = eras.find((e) => normalizeForMatch(e) === normalizedInput);
  if (exact) return exact;
  const contains = eras.find((e) => normalizeForMatch(e).includes(normalizedInput));
  if (contains) return contains;
  const inputRange = parseYearRange(text);
  if (!inputRange) return null;
  let bestEra = null;
  let bestOverlap = 0;
  for (const eraStr of eras) {
    const eraRange = parseYearRange(eraStr);
    if (!eraRange) continue;
    const overlapStart = Math.max(inputRange.start, eraRange.start);
    const overlapEnd = Math.min(inputRange.end, eraRange.end);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestEra = eraStr;
    }
  }
  return bestEra;
}

/** Construit l'objet produit plat depuis un item JSON JMBottazzi (pour prefilProductMetafields castapp). */
function buildFlatProductFromVendor(vendorProd) {
  const text = (vendorProd.title || "") + " " + (vendorProd.description || "");
  const productType = getType(vendorProd.title || "");
  const rawTourDeDoigt =
    vendorProd.taille_de_doigt != null && String(vendorProd.taille_de_doigt).trim() !== ""
      ? parseInt(String(vendorProd.taille_de_doigt).trim(), 10)
      : getTourDeDoigt(vendorProd.description || "");
  const tourDeDoigt = normalizeTourDeDoigt({
    product_type: productType,
    type: productType,
    tour_de_doigt: rawTourDeDoigt,
    title: vendorProd.title,
  });
  const matiereText = vendorProd.matiere || text;
  const pierreText = vendorProd.caracteristiques_des_pierres || text;
  return {
    sku: vendorProd.sku,
    title: vendorProd.title,
    description: vendorProd.description,
    brand: resolveBrandName(text),
    matiere: resolveMaterialNames(matiereText),
    pierre: resolveGemNames(pierreText),
    product_type: productType,
    type: productType,
    tour_de_doigt: Number.isNaN(tourDeDoigt) ? NaN : tourDeDoigt,
    style: vendorProd.nom_du_modele || null,
    epoque: resolveEraName(vendorProd.description || ""),
    condition: resolveConditionName(vendorProd.description || ""),
    genre: resolveGenreNames(vendorProd.description || ""),
    customProductType: resolveModelName(productType, vendorProd.nom_du_modele || vendorProd.title || ""),
  };
}

function normalizeTourDeDoigt(product) {
  const productType = product.product_type || product.type || getType(product.title || "");
  if (productType !== "Bagues") return NaN;
  let valeur =
    product.tour_de_doigt != null && product.tour_de_doigt !== ""
      ? parseInt(product.tour_de_doigt, 10)
      : (typeof product.tour_de_doigt === "number" ? product.tour_de_doigt : NaN);
  if (typeof valeur !== "number" || isNaN(valeur) || valeur < TOUR_DE_DOIGT_MIN || valeur > TOUR_DE_DOIGT_MAX) {
    return NaN;
  }
  return valeur;
}

// Shopify API
const client = createAdminApiClient({
  storeDomain: storeDomain,
  apiVersion: apiVersion,
  accessToken: process.env.ACCESS_TOKEN_BOTTAZZI,
});

indexJMBottazzi();

async function indexJMBottazzi() {
  loadProperties();
  console.log("property.json chargé");

  //Récupération des produits du JSON
  let productBottazziRaw = await fetchAllProductsBottazzi();
  console.log("Il y a " + productBottazziRaw.length + " produits dans le JSON");

  //Récupération des produits de Shopify pour le revendeur JMBottazzi
  let productsCastafiore = await fetchAllProductsCastafiore();
  console.log("Il y a " + productsCastafiore.length + " produits dans Shopify pour le revendeur JMBottazzi");

  let productBottazzi = productBottazziRaw;
  if (TEST_CONFIG.ENABLED) {
    const testProducts = productBottazziRaw.slice(0, TEST_CONFIG.MAX_PRODUCTS_TO_TEST);
    productBottazzi = testProducts;
    if (testProducts.length > 0) {
      const skuSet = new Set(testProducts.map((p) => p.sku).filter(Boolean));
      productsCastafiore = productsCastafiore.filter((p) => skuSet.has(p.sku?.trim()));
      console.log("🧪 MODE TEST ACTIVÉ: traitement de " + testProducts.length + " produits pour les tests");
      console.log("   📝 SKUs de test: " + testProducts.map((p) => p.sku).filter(Boolean).join(", "));
      console.log("   🧪 Castafiore filtré sur " + productsCastafiore.length + " produit(s) (SKUs de test)");
      if (TEST_CONFIG.LOG_DETAILED_DATA) {
        console.log("📊 Données détaillées des produits de test:");
        testProducts.slice(0, 5).forEach((p, i) => {
          const flat = buildFlatProductFromVendor(p);
          console.log("   " + (i + 1) + ". SKU: " + p.sku + " - " + p.title + " - brand: " + flat.brand + " - type: " + flat.product_type);
        });
      }
    }
  }

  //Comparaison des produits
  const { productToAdd, productToUpdate, productRemovedFromCSV } = await compareBottazziCastafiore(productBottazzi, productsCastafiore);

  console.log("📊 Résultats de la comparaison:");
  console.log("   ➕ Produits à ajouter: " + productToAdd.length);
  console.log("   🔄 Produits à mettre à jour: " + productToUpdate.length);
  console.log("   ❌ Produits à supprimer/mettre en stock 0: " + productRemovedFromCSV.length);

  if (TEST_CONFIG.ENABLED && TEST_CONFIG.SKIP_ACTUAL_UPDATES) {
    console.log("🧪 MODE TEST: Mises à jour simulées (aucune modification réelle)");
    console.log("   ➕ " + productToAdd.length + " produits seraient ajoutés");
    console.log("   🔄 " + productToUpdate.length + " produits seraient mis à jour");
    console.log("   ❌ " + productRemovedFromCSV.length + " produits seraient mis à stock 0");
    console.log("   💡 Pour activer les vraies mises à jour, changez TEST_CONFIG.SKIP_ACTUAL_UPDATES à false");
    console.log("--- Résumé de validation ---");
    console.log("Intégration produits : " + productToAdd.length + " produit(s) seraient ajoutés.");
    const addSample = productToAdd.slice(0, 3);
    for (let i = 0; i < addSample.length; i++) {
      const p = addSample[i];
      const m = await prefilProductMetafields(p);
      console.log("   Exemple " + (i + 1) + ": SKU " + p.sku + " - " + p.title + " - Prix " + p.price + "€ - Stock " + p.stock + " - métafields castapp: " + m.length + " clé(s)");
      if (TEST_CONFIG.LOG_METAFIELDS || TEST_CONFIG.LOG_DETAILED_DATA) {
        console.log("      Clés: " + (m.map((x) => x.key).join(", ") || "(aucune)"));
        if (TEST_CONFIG.LOG_DETAILED_DATA) console.log(JSON.stringify(m, null, 2));
      }
    }
    console.log("Sync stock : " + productToUpdate.length + " produit(s) seraient mis à jour (prix/stock/métafields).");
    const updateSample = productToUpdate.slice(0, 2);
    for (let i = 0; i < updateSample.length; i++) {
      const p = updateSample[i];
      const m = await prefilProductMetafields(p);
      console.log("   Exemple " + (i + 1) + ": productId " + p.productId + " - métafields castapp: " + m.length + " clé(s)");
      if (TEST_CONFIG.LOG_METAFIELDS || TEST_CONFIG.LOG_DETAILED_DATA) {
        console.log("      Clés: " + (m.map((x) => x.key).join(", ") || "(aucune)"));
        if (TEST_CONFIG.LOG_DETAILED_DATA) console.log(JSON.stringify(m, null, 2));
      }
    }
    console.log("Métafields : les métafields castapp seraient envoyés à l'ajout et à la mise à jour.");
    return;
  }

  //Ajout des produits à Shopify
  if (productToAdd.length > 0) await addProductsToShopify(productToAdd);

  //Mise à jour des produits sur Shopify
  if (productToUpdate.length > 0) await updateProductsOnShopify(productToUpdate);

  //Mise à jour du stock des produits sur Shopify
  if (productRemovedFromCSV.length > 0) await updateVariantStockRemovedFromCSV(productRemovedFromCSV);

  console.log("Produits JMBottazzi à ajouter : " + productToAdd.length);
}

//Récupération des produits du JSON
async function fetchAllProductsBottazzi() {
  console.log("Récupération des produits de JMBottazzi");
  const response = await fetch("https://files.channable.com/X5O8Lx91p1WOoF62Y-KvtQ==.json");

  //FORMAT FICHIER JSON RECU EXEMPLE
  /*
  {
    "additional_image_link": [
      "https://www.bijouteriebottazzi.fr/22836/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg",
      "https://www.bijouteriebottazzi.fr/9885/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg",
      "https://www.bijouteriebottazzi.fr/22834/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg",
      "https://www.bijouteriebottazzi.fr/9883/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg",
      "https://www.bijouteriebottazzi.fr/9884/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg",
      "https://www.bijouteriebottazzi.fr/9886/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg",
      "https://www.bijouteriebottazzi.fr/22835/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg"
  ],
  "brand": "false",
  "caracteristiques_des_pierres": "diamants brillants G-VS",
  "description": "Bague  signée FRED \"Candy\", en Or gris 18 carats; avec 2,70 Cts de diamant brillants, qualité G-VS, taille 52, mise à taille offerte",
  "image_link": "https://www.bijouteriebottazzi.fr/9882/bague-fred-candy-en-or-gris-18k-diamants-full-pave-taille-52-full-set.jpg",
  "matiere": "Or gris 18k",
  "mise_a_la_taille_possible": "oui",
  "nom_du_modele": "Candy",
  "price": "4980.0",
  "sku": "FB06061",
  "stock": "1.0",
  "taille_de_doigt": "52",
  "title": "Bague FRED \"Candy\" en Or gris 18k Diamants Full pavé .Taille 52. Full Set"
  }
  */

  const data = await response.json();
  return data;
}

//Récupération des produits de Shopify pour le revendeur JMBottazzi
async function fetchAllProductsCastafiore() {
  console.log("Récupération des produits de JMBottazzi sur Shopify");
  let allInventoryLevels = [];
  let afterCursor = null; // Commencer sans curseur

  while (true) {
    const operation = `
         {
          productVariants(first: 250, query: "vendor:JMBottazzi", after: ${afterCursor ? `"${afterCursor}"` : null}) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              cursor
              node {
                id
                title
                sku
                inventoryQuantity
                price
                product {
                    id
                    title
                    tags
                }
                inventoryItem {
                    id
                    tracked
                }
              }
            }
          }
        }
        `;

    const { data, errors, extensions } = await client.request(operation);

    if (errors) {
      console.log(errors);
      return;
    }

    const edges = data.productVariants.edges;
    const pageInfo = data.productVariants.pageInfo;

    console.log(pageInfo);

    allInventoryLevels = allInventoryLevels.concat(edges); // Ajouter les résultats à la liste

    if (pageInfo.hasNextPage) {
      afterCursor = pageInfo.endCursor; // Si il y a une page suivante, mettre à jour le curseur
    } else {
      break; // Si il n'y a pas de page suivante, sortir de la boucle
    }
  }

  return allInventoryLevels.map((edge) => edge.node);
}

//Comparaison des produits
async function compareBottazziCastafiore(productBottazzi, productsCastafiore) {
  const productToAdd = [];
  const productToUpdate = [];
  const productRemovedFromCSV = [];

  // Création d'une table de hachage pour les produits Shopify indexée par sku
  const shopifyMapping = {};
  const skuWithoutMapping = [];
  const duplicateSkus = new Set();
  const skuCount = {};

  // Premier passage : compter les SKUs
  productsCastafiore.forEach((prod) => {
    if (prod.sku) {
      skuCount[prod.sku] = (skuCount[prod.sku] || 0) + 1;
    }
  });

  // Identifier les SKUs en doublon
  Object.keys(skuCount).forEach(sku => {
    if (skuCount[sku] > 1) {
      duplicateSkus.add(sku);
    }
  });

  // Deuxième passage : créer le mapping en ignorant les doublons
  productsCastafiore.forEach((prod) => {
    if (prod.sku) {
      if (!duplicateSkus.has(prod.sku)) {
        shopifyMapping[prod.sku] = {
          productId: prod.product.id,
          title: prod.product.title,
          variantId: prod.id,
          inventoryItemId: prod.inventoryItem.id,
          tracked: prod.inventoryItem.tracked,
          inventoryQuantity: prod.inventoryQuantity,
          price: prod.price,
        };
      }
    } else {
      skuWithoutMapping.push({
        id: prod.id,
        title: prod.title,
        productId: prod.product.id
      });
    }
  });


  // Création d'un Set pour éviter les doublons dans productToAdd
  const skuToAdd = new Set();

  // Parcours des produits du JSON du revendeur
  productBottazzi.forEach((vendorProd) => {
    const sku = vendorProd.sku;

    if (sku && shopifyMapping.hasOwnProperty(sku)) {
      const shopifyProd = shopifyMapping[sku];
      const vendorPrice = parseInt(vendorProd.price, 10);
      const vendorStock = parseInt(vendorProd.stock, 10);
      const priceIsDifferent = parseInt(shopifyProd.price, 10) !== vendorPrice;
      const inventoryIsDifferent = parseInt(shopifyProd.inventoryQuantity, 10) !== vendorStock;
      const flat = buildFlatProductFromVendor(vendorProd);

      productToUpdate.push({
        productId: shopifyProd.productId,
        title: shopifyProd.title,
        variantId: shopifyProd.variantId,
        inventoryItemId: shopifyProd.inventoryItemId,
        price: vendorPrice,
        stock: vendorStock,
        tracked: shopifyProd.tracked,
        stockDifference: vendorStock - parseInt(shopifyProd.inventoryQuantity, 10),
        priceIsDifferent,
        inventoryIsDifferent,
        ...flat,
      });
      delete shopifyMapping[sku];
    } else if (sku && !skuToAdd.has(sku) && !duplicateSkus.has(sku)) {
      skuToAdd.add(sku);
      const flat = buildFlatProductFromVendor(vendorProd);
      const mainImage = vendorProd.image_link || "";
      const extraImages = Array.isArray(vendorProd.additional_image_link)
        ? vendorProd.additional_image_link
        : typeof vendorProd.additional_image_link === "string"
          ? vendorProd.additional_image_link.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
      const images = [mainImage, ...extraImages].filter(Boolean);

      productToAdd.push({
        ...flat,
        price: parseInt(vendorProd.price, 10),
        stock: parseInt(vendorProd.stock, 10),
        images,
        type: flat.product_type,
      });
    } else if (sku && skuToAdd.has(sku)) {
      console.log(`⚠️  Doublon détecté dans le JSON pour le SKU: ${sku} - ${vendorProd.title}`);
    } else if (sku && duplicateSkus.has(sku)) {
      console.log(`🚫 SKU en doublon ignoré: ${sku} - ${vendorProd.title}`);
    }
  });

  // Les produits restants dans shopifyMapping ne figurent pas dans le JSON : à mettre en stock 0
  Object.keys(shopifyMapping).forEach((sku) => {
    const shopifyProd = shopifyMapping[sku];
    productRemovedFromCSV.push({
      productId: shopifyProd.productId,
      inventoryItemId: shopifyProd.inventoryItemId,
      variantId: shopifyProd.variantId,
      newStock: -shopifyProd.inventoryQuantity,
    });
  });

  return { productToAdd, productToUpdate, productRemovedFromCSV };
}

//Ajout des produits à Shopify
async function addProductsToShopify(products) {
  for (const product of products) {
    const metafields = await prefilProductMetafields(product);
    const { productId, variantId, option } = await addProductToShopify(product, metafields);

    //Ajout du prix et du stock
    await productSetOptions(product, productId, variantId, option);
  }
}

//Ajout d'un produit à Shopify
async function addProductToShopify(product, metafields) {
  console.log("Ajout du produit : " + product.title);

  const operationCreate = `
    mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product {
          id
          title
          productType
          vendor
          descriptionHtml
          tags
          status
          variants: variants(first: 10) {
            edges {
              node {
                id
                inventoryQuantity
              }
            }
          }
          options {
            id
            name
            position
            optionValues {
              id
              name
              hasVariants
            }
          }
          metafields: metafields(first: 10) {
            edges {
              node {
                id
              }
            }
          }
          media(first: 10) {
            nodes {
              alt
              mediaContentType
              preview {
                status
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    product: {
      title: product.title,
      vendor: "JMBottazzi",
      productType: product.type,
      status: "DRAFT",
      tags: ["tomoderate", "nouveau"],
      descriptionHtml: product.description,
      metafields: metafields,
    },
    media: getImages(product.images, product.title),
  };

  const validTourDeDoigt = product.type === "Bagues" && product.tour_de_doigt != null && !Number.isNaN(product.tour_de_doigt) && product.tour_de_doigt >= TOUR_DE_DOIGT_MIN && product.tour_de_doigt <= TOUR_DE_DOIGT_MAX;
  if (validTourDeDoigt) {
    variables.product.productOptions = [
      {
        name: "Tour de doigt",
        values: [{ name: String(Math.round(product.tour_de_doigt)) }],
      },
    ];
  }

  var { data, errors, extensions } = await client.request(operationCreate, { variables });

  if (errors) {
    console.log(errors);
    return;
  }

  if (extensions.cost.throttleStatus.currentlyAvailable < 100) {
    sleep(extensions.cost.throttleStatus.secondsUntilAvailable * 1000);
  }

  if (data.productCreate.userErrors.length > 0) {
    console.log(data.productCreate.userErrors);
  }

  if (data.productCreate.product.id) {
    console.log("Produit créé : " + data.productCreate.product.id);
  }

  if (data.productCreate.product.variants.edges.length > 0) {
    console.log("Variant créé : " + data.productCreate.product.variants.edges[0].node.id);
  }

  console.log("Création du variant associé");

  return {
    productId: data.productCreate.product.id,
    variantId: data.productCreate.product.variants.edges[0].node.id,
    option: {
      name: data.productCreate.product.options[0].name,
      value: "Default Title",
    },
  };
}

//Mise à jour des produits sur Shopify
async function updateProductsOnShopify(products) {
  console.log("Mise à jour des " + products.length + " produits sur Shopify de JMBottazzi");
  let metafieldsSkipped = 0;
  let metafieldsUpdated = 0;
  for (const product of products) {
    if (product.priceIsDifferent) {
      console.log("Mise à jour du prix du produit : " + product.productId);
      await productVariantsBulkUpdate(product);
    }

    if (product.inventoryIsDifferent) {
      console.log("Mise à jour du stock du produit : " + product.productId);
      await adjustQuantities(product);
    }

    const metafields = await prefilProductMetafields(product);
    if (metafields.length > 0) {
      const currentMetafields = await fetchProductCastappMetafields(product.productId);
      if (metafieldsAreEqual(metafields, currentMetafields)) {
        metafieldsSkipped += 1;
      } else {
        metafieldsUpdated += 1;
        console.log("Mise à jour des métafields du produit : " + product.productId);
        await updateProductMetafields(product.productId, metafields);
      }
    } else {
      metafieldsSkipped += 1;
    }
  }
  if (metafieldsSkipped > 0 || metafieldsUpdated > 0) {
    console.log("Métafields: " + metafieldsUpdated + " mise(s) à jour, " + metafieldsSkipped + " inchangé(s)");
  }
}

async function ProductVariantsCreate(productId, variantId, optionId, price, stock, sku) {
  const operation = `
  mutation ProductVariantsCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
  `;

  const variables = {
    productId: productId,
    variants: [
      {
        id: variantId,
        optionValues: [
          {
            id: optionId,
            name: "Tour de doigt",
          },
        ],
        price: price,
        inventoryItem: {
          cost: price * pourcentage,
          sku: sku,
          tracked: true,
        },
        inventoryQuantities: [
          {
            locationId: locationId,
            availableQuantity: stock,
          },
        ],
      },
    ],
  };

  const { data, errors, extensions } = await client.request(operation, { variables });

  if (errors) {
    console.log(errors);
    return;
  }

  if (extensions.cost.throttleStatus.currentlyAvailable < 100) {
    sleep(extensions.cost.throttleStatus.secondsUntilAvailable * 1000);
  }

  if (data.productVariantsBulkCreate.userErrors.length > 0) {
    console.log(data.productVariantsBulkCreate.userErrors);
  }

  if (data.productVariantsBulkCreate.productVariants.length > 0) {
    console.log("Variant updated : " + data.productVariantsBulkCreate.productVariants[0].id);
  }

  return;
}

async function productSetOptions(product, productId, variantId, option) {
  console.log("Mise à jour des options du produit : " + variantId);
  const operation = `
    mutation productSetOptions($productSet: ProductSetInput!, $synchronous: Boolean!) {
      productSet(synchronous: $synchronous, input: $productSet) {
        product {
          id
        }
        productSetOperation {
          id
          status
          userErrors {
            code
            field
            message
          }
        }
        userErrors {
          code
          field
          message
        }
      }
    }`;

  const variables = {
    synchronous: false,
    productSet: {
      id: productId,
      variants: [
        {
          id: variantId,
          inventoryQuantities: [
            {
              locationId: locationId,
              name: "available",
              quantity: product.stock,
            },
          ],
          inventoryItem: {
            cost: product.price * pourcentage,
            sku: product.sku,
            tracked: true,
          },
          price: product.price,
        },
      ],
    },
  };

  const validTourDeDoigt = product.type === "Bagues" && product.tour_de_doigt != null && !Number.isNaN(product.tour_de_doigt) && product.tour_de_doigt >= TOUR_DE_DOIGT_MIN && product.tour_de_doigt <= TOUR_DE_DOIGT_MAX;
  if (validTourDeDoigt) {
    variables.productSet.productOptions = [
      {
        name: "Tour de doigt",
        position: 1,
        values: [{ name: String(Math.round(product.tour_de_doigt)) }],
      },
    ];
    variables.productSet.variants[0].optionValues = [
      {
        optionName: "Tour de doigt",
        name: String(Math.round(product.tour_de_doigt)),
      },
    ];
  } else {
    variables.productSet.variants[0].optionValues = [
      {
        optionName: option.name,
        name: option.value,
      },
    ];

    variables.productSet.productOptions = [
      {
        name: option.name,
        position: 1,
        values: [
          {
            name: option.value,
          },
        ],
      },
    ];
  }

  const { data, errors, extensions } = await client.request(operation, { variables });

  if (errors) {
    console.log(errors);
    return;
  }

  if (extensions.cost.throttleStatus.currentlyAvailable < 100) {
    sleep(extensions.cost.throttleStatus.secondsUntilAvailable * 1000);
  }
}

async function adjustQuantities(product) {
  console.log("Mise à jour du stock du produit : " + product.productId);
  const operation = `
    mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors {
          field
          message
        }
        inventoryAdjustmentGroup {
          createdAt
          reason
          referenceDocumentUri
          changes {
            name
            delta
          }
        }
      }
    }`;

  const variables = {
    input: {
      reason: "correction",
      name: "available",
      changes: [
        {
          delta: product.stockDifference,
          inventoryItemId: product.inventoryItemId,
          locationId: locationId,
        },
      ],
    },
  };

  const { data, errors, extensions } = await client.request(operation, { variables });

  if (errors) {
    console.log(errors);
    return;
  }
}

//Mise à jour du stock des produits sur Shopify
async function updateVariantStockRemovedFromCSV(products) {
  for (const product of products) {
    await inventoryAdjustQuantities(product);
  }
}

async function productVariantsBulkUpdate(product) {
  console.log("Mise à jour du prix du produit : " + product.productId);
  const operation = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
        }
        userErrors {
          field
          message
        }
      }
    }`;

  const variables = {
    productId: product.productId,
    variants: [
      {
        id: product.variantId,
        price: product.price.toString(),
      },
    ],
  };

  try {
    const { data, errors, extensions } = await client.request(operation, { variables });

    if (errors) {
      console.log("GraphQL errors:", errors);
      return;
    }

    if (data.productVariantsBulkUpdate.userErrors.length > 0) {
      console.log("User errors:", data.productVariantsBulkUpdate.userErrors);
      return;
    }

    if (data.productVariantsBulkUpdate.productVariants.length > 0) {
      console.log("Variant price updated successfully. New price: " + data.productVariantsBulkUpdate.productVariants[0].price);
    }
  } catch (err) {
    console.error("Error during updateVariantPrice:", err);
  }
}

async function inventoryAdjustQuantities(product) {
  const operation = `
  mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
          createdAt
          reason
          referenceDocumentUri
          changes {
            name
            delta
        }
      }
    }
  }
  `;

  const variables = {
    input: {
      reason: "correction",
      name: "available",
      changes: [
        {
          delta: product.newStock,
          inventoryItemId: product.inventoryItemId,
          locationId: locationId,
        },
      ],
    },
  };

  const { data, errors, extensions } = await client.request(operation, { variables });

  if (errors) {
    console.log(errors);
    console.log(JSON.stringify(errors.graphQLErrors[0].locations, null, 2));
    return;
  }
}

/**
 * @param {*} product
 * @returns
 */

/** Pré-remplissage des métafields castapp (namespace castapp). */
async function prefilProductMetafields(product) {
  const metafields = [];
  const productType = product.type || product.product_type;

  if (product.brand) {
    metafields.push({
      namespace: "castapp",
      key: "brands",
      type: "list.single_line_text_field",
      value: JSON.stringify([product.brand]),
    });
  }

  if (product.matiere && Array.isArray(product.matiere) && product.matiere.length > 0) {
    metafields.push({
      namespace: "castapp",
      key: "materials",
      type: "list.single_line_text_field",
      value: JSON.stringify(product.matiere),
    });
  }

  if (product.pierre && Array.isArray(product.pierre) && product.pierre.length > 0) {
    metafields.push({
      namespace: "castapp",
      key: "gem_primary",
      type: "single_line_text_field",
      value: product.pierre[0],
    });
    if (product.pierre.length > 1) {
      metafields.push({
        namespace: "castapp",
        key: "gem_secondary",
        type: "list.single_line_text_field",
        value: JSON.stringify(product.pierre.slice(1)),
      });
    }
  } else if (product.pierre && typeof product.pierre === "string") {
    metafields.push({
      namespace: "castapp",
      key: "gem_primary",
      type: "single_line_text_field",
      value: product.pierre,
    });
  }

  if (product.condition) {
    metafields.push({
      namespace: "castapp",
      key: "condition",
      type: "single_line_text_field",
      value: product.condition,
    });
  }

  if (product.genre && Array.isArray(product.genre) && product.genre.length > 0) {
    metafields.push({
      namespace: "castapp",
      key: "genre",
      type: "list.single_line_text_field",
      value: JSON.stringify(product.genre),
    });
  }

  if (product.style) {
    metafields.push({
      namespace: "castapp",
      key: "style",
      type: "single_line_text_field",
      value: product.style,
    });
  }

  if (product.epoque) {
    metafields.push({
      namespace: "castapp",
      key: "era",
      type: "single_line_text_field",
      value: product.epoque,
    });
  }

  const tourDeDoigt = product.tour_de_doigt != null && !Number.isNaN(product.tour_de_doigt) ? Number(product.tour_de_doigt) : NaN;
  if (productType === "Bagues" && !Number.isNaN(tourDeDoigt) && tourDeDoigt >= TOUR_DE_DOIGT_MIN && tourDeDoigt <= TOUR_DE_DOIGT_MAX) {
    metafields.push({
      namespace: "castapp",
      key: "tour_de_doigt",
      type: "number_decimal",
      value: String(Math.round(tourDeDoigt)),
    });
  }

  if (product.sku) {
    metafields.push({
      namespace: "castapp",
      key: "sku_seller",
      type: "single_line_text_field",
      value: product.sku,
    });
  }

  const modelKey = getModelMetafieldKey(productType);
  if (modelKey && product.customProductType) {
    metafields.push({
      namespace: "castapp",
      key: modelKey,
      type: "single_line_text_field",
      value: product.customProductType,
    });
  }

  return metafields;
}

/** Récupère les métafields castapp actuels d'un produit sur Shopify. */
async function fetchProductCastappMetafields(productId) {
  const query = `
    query getProductMetafields($id: ID!) {
      product(id: $id) {
        metafields(first: 50, namespace: "castapp") {
          edges {
            node { key value }
          }
        }
      }
    }
  `;
  const { data, errors } = await client.request(query, { variables: { id: productId } });
  if (errors) {
    console.error("Erreur fetch métafields castapp pour " + productId + ":", JSON.stringify(errors));
    return [];
  }
  if (!data?.product?.metafields?.edges?.length) return [];
  return data.product.metafields.edges.map((e) => ({ key: e.node.key, value: e.node.value }));
}

function normalizeMetafieldValueForCompare(value, type) {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (type === "number_decimal") {
    const n = parseFloat(str);
    return Number.isNaN(n) ? str : String(n);
  }
  if (type && type.startsWith("list.")) {
    try {
      return JSON.stringify(JSON.parse(str));
    } catch {
      return str;
    }
  }
  return str;
}

function metafieldsAreEqual(desired, current) {
  if (!desired || desired.length === 0) return true;
  const currentByKey = new Map((current || []).map((m) => [m.key, m.value]));
  for (const m of desired) {
    const desiredVal = normalizeMetafieldValueForCompare(m.value, m.type);
    const currentVal = currentByKey.get(m.key);
    if (currentVal === undefined || currentVal === null) return false;
    if (desiredVal !== normalizeMetafieldValueForCompare(currentVal, m.type)) return false;
  }
  return true;
}

/** Mise à jour des métafields castapp d'un produit existant. */
async function updateProductMetafields(productId, metafields) {
  if (!metafields || metafields.length === 0) return;
  const operation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    input: {
      id: productId,
      metafields: metafields.map((m) => ({
        namespace: m.namespace,
        key: m.key,
        type: m.type,
        value: typeof m.value === "string" ? m.value : JSON.stringify(m.value),
      })),
    },
  };
  const { data, errors } = await client.request(operation, { variables });
  if (errors) {
    console.error("Erreur mise à jour metafields:", errors);
    return;
  }
  if (data?.productUpdate?.userErrors?.length > 0) {
    console.warn("userErrors metafields:", data.productUpdate.userErrors);
  }
}

function getImages(images, title) {
  const urls = Array.isArray(images)
    ? images.slice(0, MAX_MEDIA_PER_PRODUCT)
    : typeof images === "string"
      ? images.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_MEDIA_PER_PRODUCT)
      : [];
  return urls.map((url) => ({
    alt: title,
    mediaContentType: "IMAGE",
    originalSource: url,
  }));
}

function getType(title = "") {
  const titleFiltered = title
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "");

  if (titleFiltered.includes("bague") || titleFiltered.includes("solitaire") || titleFiltered.includes("alliance")) {
    return "Bagues";
  } else if (titleFiltered.includes("bracelet")) {
    return "Bracelets";
  } else if (titleFiltered.includes("collier")) {
    return "Colliers";
  } else if (titleFiltered.includes("boucle d'oreille") || titleFiltered.includes("boucle d'oreilles") || titleFiltered.includes("boucles d'oreilles")) {
    return "Boucles d'oreilles";
  } else if (titleFiltered.includes("pendentif") || titleFiltered.includes("croix") || titleFiltered.includes("medaille")) {
    return "Pendentifs";
  } else if (titleFiltered.includes("broche")) {
    return "Broches";
  } else if (titleFiltered.includes("montre")) {
    return "Montres";
  } else if (titleFiltered.includes("parure")) {
    return "Parures";
  } else if (titleFiltered.includes("accessoire") || titleFiltered.includes("boucles de ceinture") || titleFiltered.includes("peigne")) {
    return "Accessoires";
  } else {
    return "";
  }
}

function getTourDeDoigt(description = "") {
  // Normaliser le titre
  const titleFiltered = description
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Rechercher un nombre après le mot "taille"
  const tailleMatch = titleFiltered.match(/taille\s*(\d{2})/i);
  if (tailleMatch) {
    const taille = parseInt(tailleMatch[1]);
    if (taille >= 38 && taille <= 80) {
      return taille;
    }
  }

  // Si pas trouvé après "taille", chercher n'importe quel nombre entre 38 et 80
  const numberMatch = titleFiltered.match(/\b(\d{2})\b/g);
  if (numberMatch) {
    for (const num of numberMatch) {
      const taille = parseInt(num);
      if (taille >= 38 && taille <= 80) {
        return taille;
      }
    }
  }

  // Valeur par défaut si aucune taille valide n'est trouvée
  return 52;
}
