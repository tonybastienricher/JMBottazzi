import { createAdminApiClient } from "@shopify/admin-api-client";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const apiVersion = "2025-01";
const storeDomain = "wallis-paris.myshopify.com";
const locationId = "gid://shopify/Location/66135490720"; // France
const pourcentage = 0.9;

const brandMetafieldDefinitionID = "gid://shopify/MetafieldDefinition/2633007431";
const materialMetafieldDefinitionID = "gid://shopify/MetafieldDefinition/451903648";
const stoneMetafieldDefinitionID = "gid://shopify/MetafieldDefinition/448626848";

// Shopify API
const client = createAdminApiClient({
  storeDomain: storeDomain,
  apiVersion: apiVersion,
  accessToken: process.env.ACCESS_TOKEN_BOTTAZZI,
});

indexJMBottazzi();

async function indexJMBottazzi() {
  //Récupération des produits du JSON
  const productBottazzi = await fetchAllProductsBottazzi();
  console.log("Il y a " + productBottazzi.length + " produits dans le JSON");

  //Récupération des produits de Shopify pour le revendeur JMBottazzi
  const productsCastafiore = await fetchAllProductsCastafiore();
  console.log("Il y a " + productsCastafiore.length + " produits dans Shopify pour le revendeur JMBottazzi");

  //Comparaison des produits
  const { productToAdd, productToUpdate, productRemovedFromCSV } = await compareBottazziCastafiore(productBottazzi, productsCastafiore);

  //Ajout des produits à Shopify
  await addProductsToShopify(productToAdd);
  console.log(JSON.stringify(productToAdd, null, 2));

  //Mise à jour des produits sur Shopify
  await updateProductsOnShopify(productToUpdate);
  console.log(JSON.stringify(productToUpdate, null, 2));

  //Mise à jour du stock des produits sur Shopify
  await updateVariantStockRemovedFromCSV(productRemovedFromCSV);

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
      // Le produit existe sur Shopify, comparer stock et prix
      const shopifyProd = shopifyMapping[sku];


      if (parseInt(shopifyProd.inventoryQuantity) !== parseInt(vendorProd.stock) || parseInt(shopifyProd.price) !== parseInt(vendorProd.price)) {
        productToUpdate.push({
          productId: shopifyProd.productId,
          variantId: shopifyProd.variantId,
          inventoryItemId: shopifyProd.inventoryItemId,
          price: parseInt(vendorProd.price),
          stock: parseInt(vendorProd.stock),
          tracked: shopifyProd.tracked,
          stockDifference: parseInt(vendorProd.stock) - parseInt(shopifyProd.inventoryQuantity),
          priceIsDifferent: parseInt(shopifyProd.price) !== parseInt(vendorProd.price),
          inventoryIsDifferent: parseInt(shopifyProd.inventoryQuantity) !== parseInt(vendorProd.stock),
        });
      }
      // Produit traité, on le retire de la table
      delete shopifyMapping[sku];
    } else if (sku && !skuToAdd.has(sku)) {
      // Produit absent sur Shopify, à ajouter (vérification des doublons)
      skuToAdd.add(sku);
      productToAdd.push({
        sku: vendorProd.sku,
        title: vendorProd.title,
        description: vendorProd.description,
        price: parseInt(vendorProd.price),
        stock: parseInt(vendorProd.stock),
        images: vendorProd.image_link + "," + vendorProd.additional_image_link,
        type: getType(vendorProd.title),
        tour_de_doigt: vendorProd.tour_de_doigt != "" ? parseInt(vendorProd.tour_de_doigt) : getTourDeDoigt(vendorProd.description),
        matiere: vendorProd.matiere,
        pierre: vendorProd.caracteristiques_des_pierres,
        caracteristiques_des_pierres: vendorProd.caracteristiques_des_pierres,
        mise_a_la_taille_possible: vendorProd.mise_a_la_taille_possible,
        nom_du_modele: vendorProd.nom_du_modele,
      });
    } else if (sku && skuToAdd.has(sku)) {
      console.log(`⚠️  Doublon détecté dans le JSON pour le SKU: ${sku} - ${vendorProd.title}`);
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

  if (product.type === "Bagues") {
    variables.product.productOptions = [
      {
        name: "Tour de doigt",
        values: [{ name: product.tour_de_doigt.toString() }],
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
  for (const product of products) {
    if (product.priceIsDifferent) {
      console.log("Mise à jour du prix du produit : " + product.productId);
      await productVariantsBulkUpdate(product);
    }

    if (product.inventoryIsDifferent) {
      console.log("Mise à jour du stock du produit : " + product.productId);
      await adjustQuantities(product);
    }
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

  if (product.type === "Bagues") {
    variables.productSet.productOptions = [
      {
        name: "Tour de doigt",
        position: 1,
        values: [
          {
            name: product.tour_de_doigt.toString(),
          },
        ],
      },
    ];

    variables.productSet.variants[0].optionValues = [
      {
        optionName: "Tour de doigt",
        name: product.tour_de_doigt.toString(),
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

//Pré-remplissage des metafields
async function prefilProductMetafields(product) {
  const metafields = [];

  const brand = await getBrand(product.title + " " + product.description);

  if (brand) {
    metafields.push({
      key: "brand",
      namespace: "filter",
      type: "single_line_text_field",
      value: brand,
    });
  }

  const material = await getMaterial(product.title + " " + product.description);

  if (material) {
    metafields.push({
      key: "matiere",
      namespace: "my_fields",
      type: "list.single_line_text_field",
      value: JSON.stringify(material),
    });
  }

  const gemme = await getGemme(product.title + " " + product.description);

  if (gemme) {
    metafields.push({
      key: "pierre",
      namespace: "my_fields",
      type: "list.single_line_text_field",
      value: JSON.stringify(gemme),
    });
  }

  return metafields;
}

//Récupération de la marque du produit
async function getBrand(title = "") {
  const brands = await fetchMetafieldsValues(brandMetafieldDefinitionID);

  let titleFiltered = "Non signé";

  // Normalize the title
  const normalizedTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

  brands.forEach((currentValue) => {
    // Normalize the current brand name
    const normalizedBrand = currentValue
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();

    if (normalizedTitle.includes(normalizedBrand)) {
      titleFiltered = currentValue;
    }
  });

  return titleFiltered;
}

//Récupération du matériel du produit
async function getMaterial(title = "") {
  const materials = await fetchMetafieldsValues(materialMetafieldDefinitionID);

  const material = materials.find((material) => title.toLowerCase().includes(material.toLowerCase()));

  let foundMaterials = [];

  for (const material of materials) {
    if (title.toLowerCase().includes(material.toLowerCase())) {
      foundMaterials.push(material);
    }
  }

  return foundMaterials;
}

//Récupération de la gemme du produit
async function getGemme(title = "") {
  const gemmes = await fetchMetafieldsValues(stoneMetafieldDefinitionID);

  let foundGemmes = [];

  for (const gemme of gemmes) {
    if (title.toLowerCase().includes(gemme.toLowerCase())) {
      foundGemmes.push(gemme);
    }
  }

  return foundGemmes;
}

//Récupération des valeurs des metafields
async function fetchMetafieldsValues(metafieldDefinitionID) {
  const query = `
    {
        metafieldDefinition(id: "${metafieldDefinitionID}") {
          name
          type {
            category
            supportedValidations {
              name
              type
            }
            name
          }
          validations {
            name
            value
            type
          }
        }
      }
    `;

  const { data, errors, extensions } = await client.request(query);

  if (errors) {
    console.error(errors);
    return [];
  }

  console.log(data.metafieldDefinition.name + " récupéré.es");

  return JSON.parse(data.metafieldDefinition.validations[0].value, null, 2);
}

function getImages(images, title) {
  const imagesToAdd = [];

  for (const image of images.split(",")) {
    imagesToAdd.push({
      alt: title,
      mediaContentType: "IMAGE",
      originalSource: image,
    });
  }

  return imagesToAdd;
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
