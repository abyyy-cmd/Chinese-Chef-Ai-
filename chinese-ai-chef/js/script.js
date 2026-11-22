/**
 * ============================================================================
 * Chinese AI Chef - Frontend Logic
 * Technology: Vanilla JavaScript (ES6+), Fetch API
 * Backend: n8n AI Workflow via Webhook
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. Webhook Configuration
// ----------------------------------------------------------------------------
/**
 * Primary webhook configuration placeholder as required by the specification.
 * You can paste your active n8n webhook URL directly here or use the UI setup dialog.
 */
const N8N_WEBHOOK_URL = "PASTE_YOUR_N8N_WEBHOOK_URL_HERE";

// ----------------------------------------------------------------------------
// 2. Application State
// ----------------------------------------------------------------------------
const AppState = {
  // Current mode: "by_name" (Mode A) or "pantry" (Mode B)
  currentMode: "by_name",
  
  // List of pantry ingredients entered in Mode B
  pantryIngredients: [],
  
  // Currently displayed recipe data
  currentRecipe: null,
  
  // Shopping list items: Array of { id, name, quantity, completed }
  shoppingList: [],
  
  // Recipe rating value (1 to 5)
  selectedRating: 0,
  
  // Active request flags to prevent duplicate submissions
  isGeneratingRecipe: false,
  isEmailingRecipe: false,
  isSubmittingRating: false,
  isEmailingShoppingList: false
};

// ----------------------------------------------------------------------------
// 3. Helper Utilities
// ----------------------------------------------------------------------------

/**
 * Retrieves the effective n8n Webhook URL.
 * Checks localStorage override first, then falls back to N8N_WEBHOOK_URL constant.
 */
function getWebhookUrl() {
  const localUrl = localStorage.getItem("chinese_chef_n8n_webhook_url");
  if (localUrl && localUrl.trim().length > 0) {
    return localUrl.trim();
  }
  return N8N_WEBHOOK_URL;
}

/**
 * Checks whether the current webhook URL is still the placeholder.
 */
function isWebhookConfigured() {
  const url = getWebhookUrl();
  return url && url !== "PASTE_YOUR_N8N_WEBHOOK_URL_HERE" && url.trim().startsWith("http");
}

/**
 * Validates basic email address format.
 */
function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
}

/**
 * Escapes HTML characters to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Display a floating toast notification.
 * @param {string} message - Notification text
 * @param {"success"|"error"|"info"} type - Type of toast
 * @param {number} duration - Milliseconds to show
 */
function showToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  const icon = type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-fadeout");
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, duration);
}

/**
 * Renders an inline feedback message for forms.
 */
function setInlineFeedback(elementId, message, type = "success") {
  const el = document.getElementById(elementId);
  if (!el) return;

  if (!message) {
    el.className = "action-feedback hidden";
    el.textContent = "";
    return;
  }

  el.className = `action-feedback feedback-${type}`;
  el.textContent = message;
}

// ----------------------------------------------------------------------------
// 4. n8n API Client
// ----------------------------------------------------------------------------

/**
 * Communicates with the n8n webhook using POST requests.
 * Safely parses JSON / text responses and handles HTTP, CORS, and network errors.
 * 
 * @param {string} action - Action name (e.g. generate_recipe, email_shopping_list, email_recipe, rate_recipe)
 * @param {object} data - Payload data object
 * @param {string} [timestamp] - Optional ISO timestamp for rate_recipe
 * @returns {Promise<any>}
 */
async function sendN8NRequest(action, data, timestamp = null) {
  const webhookUrl = getWebhookUrl();

  if (!isWebhookConfigured()) {
    throw new Error(
      "Webhook URL is not yet configured. Please configure your live n8n webhook URL via the 'Webhook Setup' button."
    );
  }

  // Construct payload adhering to the requirements
  const payload = {
    action: action,
    data: data
  };

  if (timestamp) {
    payload.timestamp = timestamp;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errorDetail = `Server responded with HTTP ${response.status} (${response.statusText})`;
      try {
        const errorJson = await response.json();
        if (errorJson && (errorJson.message || errorJson.error)) {
          errorDetail = errorJson.message || errorJson.error;
        }
      } catch (e) {
        // Response was not JSON, try text
        try {
          const errorText = await response.text();
          if (errorText) errorDetail += `: ${errorText.slice(0, 150)}`;
        } catch (_) {}
      }
      throw new Error(errorDetail);
    }

    // Try parsing as JSON first
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }

    // Non-JSON response or fallback
    const rawText = await response.text();
    try {
      return JSON.parse(rawText);
    } catch (e) {
      // Plain text or markdown output from n8n response node
      return { text: rawText };
    }

  } catch (err) {
    // Check if error is likely a CORS or network unreachable error
    if (err.name === "TypeError" && err.message.toLowerCase().includes("fetch")) {
      throw new Error(
        "Network or CORS request failed. Please check that your n8n workflow is running and that its Webhook node allows requests."
      );
    }
    throw err;
  }
}

// ----------------------------------------------------------------------------
// 5. Recipe Parsing & Defensive Extraction
// ----------------------------------------------------------------------------

/**
 * Defensive extractor that parses recipe text or object from n8n into a standard shape.
 * Supported source formats:
 * - Structured object: { title, description, ingredients: [...], steps: [...], tips, servingSuggestions, id }
 * - Markdown / text string within fields: text, reply, response, output, recipe, or the root response itself.
 */
function extractRecipeData(response, requestedTitle = "", requestedServings = 2) {
  if (!response) {
    return null;
  }

  let raw = response;

  // Handle nested objects: e.g. { data: ... } or [ { ... } ]
  if (Array.isArray(raw) && raw.length > 0) {
    raw = raw[0];
  }
  if (raw && typeof raw === "object" && raw.data && typeof raw.data === "object") {
    raw = { ...raw.data, ...raw };
  }

  // Look for recipe string in known n8n output fields
  let textContent = "";
  if (typeof raw === "string") {
    textContent = raw;
  } else if (raw && typeof raw === "object") {
    const candidateFields = ["text", "reply", "response", "output", "recipe", "content", "message"];
    for (const field of candidateFields) {
      if (raw[field] && typeof raw[field] === "string" && raw[field].trim().length > 0) {
        textContent = raw[field];
        break;
      }
    }
  }

  // Check if we have an already structured object with ingredients and steps
  if (raw && typeof raw === "object" && (Array.isArray(raw.ingredients) || Array.isArray(raw.steps))) {
    return {
      id: raw.id || raw.recipeId || null,
      name: raw.name || raw.title || requestedTitle || "Chinese AI Chef Special",
      description: raw.description || raw.desc || "An authentic Chinese culinary recipe prepared with traditional techniques.",
      servings: raw.servings || requestedServings,
      ingredients: Array.isArray(raw.ingredients) ? raw.ingredients.map(formatIngredientItem) : [],
      steps: Array.isArray(raw.steps) ? raw.steps : [],
      tips: raw.tips || raw.cookingTips || "",
      servingSuggestions: raw.servingSuggestions || raw.pairings || "",
      markdown: textContent || buildMarkdownFromObject(raw),
      rawOutput: raw
    };
  }

  // If textContent is available, parse Markdown / plain text
  if (textContent && textContent.trim().length > 0) {
    return parseRecipeMarkdown(textContent, requestedTitle, requestedServings, raw.id || raw.recipeId || null);
  }

  // If raw object has some other keys
  return null;
}

function formatIngredientItem(item) {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    if (item.name && item.quantity) return `${item.quantity} ${item.name}`;
    if (item.name) return item.name;
  }
  return String(item);
}

function buildMarkdownFromObject(obj) {
  let md = `# ${obj.name || obj.title || "Recipe"}\n\n`;
  if (obj.description) md += `${obj.description}\n\n`;
  if (Array.isArray(obj.ingredients) && obj.ingredients.length > 0) {
    md += `## Ingredients\n`;
    obj.ingredients.forEach(ing => {
      md += `- ${formatIngredientItem(ing)}\n`;
    });
    md += `\n`;
  }
  if (Array.isArray(obj.steps) && obj.steps.length > 0) {
    md += `## Instructions\n`;
    obj.steps.forEach((step, idx) => {
      md += `${idx + 1}. ${step}\n`;
    });
    md += `\n`;
  }
  if (obj.tips) md += `## Tips\n${obj.tips}\n\n`;
  if (obj.servingSuggestions) md += `## Serving Suggestions\n${obj.servingSuggestions}\n\n`;
  return md;
}

/**
 * Parses Markdown-formatted recipe text into structured components.
 */
function parseRecipeMarkdown(mdText, defaultTitle, defaultServings, recipeId = null) {
  const lines = mdText.split(/\r?\n/);
  
  let title = "";
  let description = "";
  const ingredients = [];
  const steps = [];
  let tips = "";
  let servingSuggestions = "";

  let currentSection = "header"; // "header" | "ingredients" | "steps" | "tips" | "serving"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect Title (e.g. # Title or **Title**)
    if (!title && (line.startsWith("# ") || line.startsWith("## "))) {
      title = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
      continue;
    }

    // Detect section headers
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes("ingredient")) {
      currentSection = "ingredients";
      continue;
    } else if (
      lowerLine.includes("instruction") || 
      lowerLine.includes("direction") || 
      lowerLine.includes("step") || 
      lowerLine.includes("cooking step") ||
      lowerLine.includes("method")
    ) {
      currentSection = "steps";
      continue;
    } else if (lowerLine.includes("tip") || lowerLine.includes("secret") || lowerLine.includes("chef's note")) {
      currentSection = "tips";
      continue;
    } else if (lowerLine.includes("serving") || lowerLine.includes("pairing") || lowerLine.includes("how to serve")) {
      currentSection = "serving";
      continue;
    }

    // Process section lines
    if (currentSection === "header") {
      if (!title && line.length < 60 && !line.includes(":") && !line.startsWith("-")) {
        title = line.replace(/\*\*/g, "");
      } else {
        description += (description ? " " : "") + line.replace(/\*\*/g, "");
      }
    } else if (currentSection === "ingredients") {
      // Bullet items or lines
      const cleanLine = line.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "").trim();
      if (cleanLine.length > 0) {
        ingredients.push(cleanLine);
      }
    } else if (currentSection === "steps") {
      // Numbered or bullet steps
      const cleanLine = line.replace(/^\d+[\.\)]\s*/, "").replace(/^[-*•]\s*/, "").trim();
      if (cleanLine.length > 0) {
        steps.push(cleanLine);
      }
    } else if (currentSection === "tips") {
      tips += (tips ? "\n" : "") + line.replace(/^[-*•]\s*/, "");
    } else if (currentSection === "serving") {
      servingSuggestions += (servingSuggestions ? "\n" : "") + line.replace(/^[-*•]\s*/, "");
    }
  }

  // Fallbacks
  if (!title) {
    title = defaultTitle || "Authentic Chinese Dish";
  }

  return {
    id: recipeId,
    name: title,
    description: description || "Freshly crafted recipe by Chinese AI Chef.",
    servings: defaultServings,
    ingredients: ingredients,
    steps: steps,
    tips: tips,
    servingSuggestions: servingSuggestions,
    markdown: mdText,
    rawOutput: mdText
  };
}

// ----------------------------------------------------------------------------
// 6. UI Rendering & Interactions
// ----------------------------------------------------------------------------

/**
 * Initializes and updates the Webhook status badge and warning banner.
 */
function updateWebhookStatusUI() {
  const isConfigured = isWebhookConfigured();
  const dot = document.getElementById("webhook-status-dot");
  const label = document.getElementById("webhook-status-label");
  const banner = document.getElementById("webhook-notice-banner");

  if (isConfigured) {
    if (dot) dot.className = "status-dot status-connected";
    if (label) label.textContent = "Webhook Ready";
    if (banner) banner.classList.add("hidden");
  } else {
    if (dot) dot.className = "status-dot status-pending";
    if (label) label.textContent = "Webhook Setup";
    if (banner && !sessionStorage.getItem("dismissed_webhook_notice")) {
      banner.classList.remove("hidden");
    }
  }
}

/**
 * Displays the recipe result card and hides empty/loading/error cards.
 */
function renderRecipeResult(recipe) {
  const emptyState = document.getElementById("recipe-empty-state");
  const loadingState = document.getElementById("recipe-loading-state");
  const errorState = document.getElementById("recipe-error-state");
  const contentCard = document.getElementById("recipe-content-card");

  emptyState.classList.add("hidden");
  loadingState.classList.add("hidden");
  errorState.classList.add("hidden");

  if (!recipe) {
    emptyState.classList.remove("hidden");
    contentCard.classList.add("hidden");
    return;
  }

  // Populate Header & Badges
  document.getElementById("recipe-display-title").textContent = recipe.name;
  document.getElementById("recipe-display-desc").textContent = recipe.description;
  document.getElementById("recipe-display-servings").textContent = recipe.servings;
  document.getElementById("recipe-display-mode").textContent = 
    AppState.currentMode === "pantry" ? "From Pantry Ingredients" : "By Dish Name";

  // Render Ingredients List
  const ingListEl = document.getElementById("recipe-ingredients-list");
  const ingCountTag = document.getElementById("ingredients-count-tag");
  ingListEl.innerHTML = "";

  if (recipe.ingredients && recipe.ingredients.length > 0) {
    ingCountTag.textContent = `${recipe.ingredients.length} items`;
    recipe.ingredients.forEach((ing, index) => {
      const li = document.createElement("li");
      li.className = "recipe-ingredient-item";
      li.innerHTML = `
        <input type="checkbox" class="ingredient-checkbox" id="rec-ing-${index}" title="Check off ingredient">
        <label for="rec-ing-${index}" class="ingredient-text">${escapeHtml(ing)}</label>
      `;
      ingListEl.appendChild(li);
    });
  } else {
    ingCountTag.textContent = "0 items";
    ingListEl.innerHTML = `<li class="recipe-ingredient-item"><span class="ingredient-text">Refer to recipe details below.</span></li>`;
  }

  // Render Cooking Steps
  const stepsListEl = document.getElementById("recipe-steps-list");
  const stepsCountTag = document.getElementById("steps-count-tag");
  stepsListEl.innerHTML = "";

  if (recipe.steps && recipe.steps.length > 0) {
    stepsCountTag.textContent = `${recipe.steps.length} steps`;
    recipe.steps.forEach((step, index) => {
      const li = document.createElement("li");
      li.className = "recipe-step-item";
      li.innerHTML = `
        <div class="step-num-badge">${index + 1}</div>
        <div class="step-text">${escapeHtml(step)}</div>
      `;
      stepsListEl.appendChild(li);
    });
  } else {
    stepsCountTag.textContent = "0 steps";
    stepsListEl.innerHTML = `<li class="recipe-step-item"><div class="step-text">Refer to recipe details below.</div></li>`;
  }

  // Tips Card
  const tipsCard = document.getElementById("recipe-tips-card");
  const tipsContent = document.getElementById("recipe-tips-content");
  if (recipe.tips && recipe.tips.trim().length > 0) {
    tipsContent.textContent = recipe.tips;
    tipsCard.classList.remove("hidden");
  } else {
    tipsCard.classList.add("hidden");
  }

  // Serving Suggestions Card
  const servingCard = document.getElementById("recipe-serving-card");
  const servingContent = document.getElementById("recipe-serving-content");
  if (recipe.servingSuggestions && recipe.servingSuggestions.trim().length > 0) {
    servingContent.textContent = recipe.servingSuggestions;
    servingCard.classList.remove("hidden");
  } else {
    servingCard.classList.add("hidden");
  }

  // Fallback Raw Content (if ingredients and steps could not be cleanly separated)
  const rawFallback = document.getElementById("recipe-raw-fallback");
  const rawContent = document.getElementById("recipe-raw-content");
  if (recipe.ingredients.length === 0 && recipe.steps.length === 0 && recipe.markdown) {
    rawContent.textContent = recipe.markdown;
    rawFallback.classList.remove("hidden");
  } else {
    rawFallback.classList.add("hidden");
  }

  // Reset email & rating feedback for the new recipe
  setInlineFeedback("email-recipe-feedback", "");
  setInlineFeedback("rating-feedback", "");
  resetRatingWidget();

  contentCard.classList.remove("hidden");
  contentCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Sets the recipe generation loading state.
 */
function setRecipeLoadingState(isLoading) {
  AppState.isGeneratingRecipe = isLoading;

  const btnName = document.getElementById("btn-generate-name");
  const btnPantry = document.getElementById("btn-generate-pantry");
  const emptyState = document.getElementById("recipe-empty-state");
  const loadingState = document.getElementById("recipe-loading-state");
  const errorState = document.getElementById("recipe-error-state");
  const contentCard = document.getElementById("recipe-content-card");

  if (isLoading) {
    btnName.disabled = true;
    btnName.classList.add("loading");
    btnPantry.disabled = true;
    btnPantry.classList.add("loading");

    emptyState.classList.add("hidden");
    errorState.classList.add("hidden");
    contentCard.classList.add("hidden");
    loadingState.classList.remove("hidden");
  } else {
    btnName.disabled = false;
    btnName.classList.remove("loading");
    btnPantry.disabled = false;
    btnPantry.classList.remove("loading");
    loadingState.classList.add("hidden");
  }
}

/**
 * Shows an error in the recipe result area.
 */
function setRecipeErrorState(errorMessage) {
  const emptyState = document.getElementById("recipe-empty-state");
  const loadingState = document.getElementById("recipe-loading-state");
  const errorState = document.getElementById("recipe-error-state");
  const contentCard = document.getElementById("recipe-content-card");

  emptyState.classList.add("hidden");
  loadingState.classList.add("hidden");
  contentCard.classList.add("hidden");

  document.getElementById("recipe-error-message").textContent = 
    errorMessage || "An unexpected error occurred while communicating with n8n.";
  
  errorState.classList.remove("hidden");
}

// ----------------------------------------------------------------------------
// 7. Mode B: Pantry Ingredients Management
// ----------------------------------------------------------------------------

function renderPantryTags() {
  const container = document.getElementById("pantry-tags-container");
  const countEl = document.getElementById("ingredient-count");
  const emptyHint = document.getElementById("empty-tags-hint");

  countEl.textContent = AppState.pantryIngredients.length;

  // Clear tags except hint
  container.innerHTML = "";

  if (AppState.pantryIngredients.length === 0) {
    container.appendChild(emptyHint);
    emptyHint.classList.remove("hidden");
    return;
  }

  AppState.pantryIngredients.forEach((item, index) => {
    const tag = document.createElement("div");
    tag.className = "ingredient-tag";
    tag.setAttribute("role", "listitem");
    tag.innerHTML = `
      <span>${escapeHtml(item)}</span>
      <button type="button" class="btn-remove-tag" data-index="${index}" title="Remove ${escapeHtml(item)}">&times;</button>
    `;
    container.appendChild(tag);
  });
}

function addPantryIngredient(name) {
  if (!name || typeof name !== "string") return;
  const clean = name.trim();
  if (clean.length === 0) return;

  // Prevent duplicate items
  const exists = AppState.pantryIngredients.some(i => i.toLowerCase() === clean.toLowerCase());
  if (exists) {
    showToast(`"${clean}" is already in your ingredients list.`, "info");
    return;
  }

  AppState.pantryIngredients.push(clean);
  renderPantryTags();
}

function removePantryIngredient(index) {
  AppState.pantryIngredients.splice(index, 1);
  renderPantryTags();
}

// ----------------------------------------------------------------------------
// 8. Shopping List Management (Section 5.4)
// ----------------------------------------------------------------------------

function loadShoppingListFromStorage() {
  try {
    const saved = localStorage.getItem("chinese_chef_shopping_list");
    if (saved) {
      AppState.shoppingList = JSON.parse(saved);
    }
  } catch (e) {
    AppState.shoppingList = [];
  }
}

function saveShoppingListToStorage() {
  try {
    localStorage.setItem("chinese_chef_shopping_list", JSON.stringify(AppState.shoppingList));
  } catch (e) {}
}

function renderShoppingList() {
  const ul = document.getElementById("shopping-list-ul");
  const countBadge = document.getElementById("shopping-items-count");
  const navBadge = document.getElementById("nav-shopping-badge");
  const emptyHint = document.getElementById("shopping-empty-hint");
  const statusText = document.getElementById("shopping-completed-status");

  const total = AppState.shoppingList.length;
  const completedCount = AppState.shoppingList.filter(i => i.completed).length;

  countBadge.textContent = `${total} items`;
  navBadge.textContent = total;
  statusText.textContent = `${completedCount} of ${total} completed`;

  ul.innerHTML = "";

  if (total === 0) {
    emptyHint.classList.remove("hidden");
    return;
  }

  emptyHint.classList.add("hidden");

  AppState.shoppingList.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = `shopping-item-row ${item.completed ? "completed" : ""}`;
    
    li.innerHTML = `
      <input 
        type="checkbox" 
        class="shopping-item-checkbox" 
        data-index="${index}" 
        ${item.completed ? "checked" : ""}
        aria-label="Mark ${escapeHtml(item.name)} as completed"
      >
      <div class="shopping-item-content">
        <span class="shopping-item-name">${escapeHtml(item.name)}</span>
        ${item.quantity ? `<span class="shopping-item-qty">${escapeHtml(item.quantity)}</span>` : ""}
      </div>
      <button 
        type="button" 
        class="btn-delete-item" 
        data-index="${index}" 
        title="Delete item"
        aria-label="Delete ${escapeHtml(item.name)}"
      >&times;</button>
    `;

    ul.appendChild(li);
  });
}

function addShoppingListItem(name, quantity = "") {
  if (!name || typeof name !== "string") return;
  const cleanName = name.trim();
  if (cleanName.length === 0) return;

  AppState.shoppingList.push({
    id: "item_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
    name: cleanName,
    quantity: (quantity || "").trim(),
    completed: false
  });

  saveShoppingListToStorage();
  renderShoppingList();
}

function toggleShoppingItem(index) {
  if (AppState.shoppingList[index]) {
    AppState.shoppingList[index].completed = !AppState.shoppingList[index].completed;
    saveShoppingListToStorage();
    renderShoppingList();
  }
}

function deleteShoppingItem(index) {
  AppState.shoppingList.splice(index, 1);
  saveShoppingListToStorage();
  renderShoppingList();
}

function clearCompletedShoppingItems() {
  const initialLen = AppState.shoppingList.length;
  AppState.shoppingList = AppState.shoppingList.filter(i => !i.completed);
  saveShoppingListToStorage();
  renderShoppingList();
  const removed = initialLen - AppState.shoppingList.length;
  if (removed > 0) {
    showToast(`Removed ${removed} completed items.`, "info");
  }
}

function clearAllShoppingItems() {
  if (AppState.shoppingList.length === 0) return;
  if (confirm("Are you sure you want to clear your entire shopping list?")) {
    AppState.shoppingList = [];
    saveShoppingListToStorage();
    renderShoppingList();
    showToast("Shopping list cleared.", "info");
  }
}

/**
 * Imports all ingredients from current active recipe into shopping list.
 */
function importRecipeIngredientsToShoppingList() {
  if (!AppState.currentRecipe || !AppState.currentRecipe.ingredients) {
    showToast("No recipe available to import from.", "error");
    return;
  }

  let addedCount = 0;
  AppState.currentRecipe.ingredients.forEach(rawIng => {
    // Basic quantity extraction: split leading digits/measurements
    const match = rawIng.match(/^([\d\/\.\s]+(tbsp|tsp|cups?|g|kg|ml|oz|lbs?|cloves?|stalks?|bunch|slices?|pinch|pieces?|can|pack)?)[\s\:\-]+(.+)$/i);
    let qty = "";
    let name = rawIng;

    if (match) {
      qty = match[1].trim();
      name = match[3].trim();
    }

    addShoppingListItem(name, qty);
    addedCount++;
  });

  showToast(`Added ${addedCount} ingredients to your shopping list!`, "success");
}

// ----------------------------------------------------------------------------
// 9. Star Rating Widget (Section 5.6)
// ----------------------------------------------------------------------------

function updateRatingStars(rating) {
  const stars = document.querySelectorAll("#star-rating-control .star-btn");
  const label = document.getElementById("rating-text-label");

  const ratingLabels = {
    0: "Select stars",
    1: "1 star - Needs Work",
    2: "2 stars - Fair",
    3: "3 stars - Good",
    4: "4 stars - Very Tasty",
    5: "5 stars - Authentic Perfection!"
  };

  stars.forEach((btn, index) => {
    const starValue = index + 1;
    if (starValue <= rating) {
      btn.classList.add("active");
      btn.setAttribute("aria-checked", starValue === rating ? "true" : "false");
    } else {
      btn.classList.remove("active");
      btn.setAttribute("aria-checked", "false");
    }
  });

  if (label) {
    label.textContent = ratingLabels[rating] || `${rating} stars`;
  }
}

function resetRatingWidget() {
  AppState.selectedRating = 0;
  updateRatingStars(0);
  const commentInput = document.getElementById("rating-comment");
  if (commentInput) commentInput.value = "";
}

// ----------------------------------------------------------------------------
// 10. Form Handlers & n8n Actions
// ----------------------------------------------------------------------------

/**
 * Action: generate_recipe (Mode A: By Dish Name)
 */
async function handleGenerateByName(e) {
  e.preventDefault();
  if (AppState.isGeneratingRecipe) return;

  const dishInput = document.getElementById("dish-name-input");
  const servingsInput = document.getElementById("servings-name");

  const dishName = dishInput.value.trim();
  const servings = parseInt(servingsInput.value, 10) || 2;

  // Validation
  if (!dishName) {
    showToast("Please enter a Chinese dish or recipe name.", "error");
    dishInput.focus();
    return;
  }

  AppState.currentMode = "by_name";
  setRecipeLoadingState(true);

  // Exact request structure specified in Section 5.2
  const payloadData = {
    message: dishName,
    servings: servings,
    ingredients: [],
    mode: "by_name"
  };

  try {
    const response = await sendN8NRequest("generate_recipe", payloadData);
    const parsedRecipe = extractRecipeData(response, dishName, servings);

    if (!parsedRecipe) {
      throw new Error("No usable recipe content was returned by the workflow.");
    }

    AppState.currentRecipe = parsedRecipe;
    renderRecipeResult(parsedRecipe);
    showToast(`Recipe for "${parsedRecipe.name}" generated successfully!`, "success");

  } catch (err) {
    console.error("Recipe generation error:", err);
    setRecipeErrorState(err.message);
    showToast(err.message, "error");
  } finally {
    setRecipeLoadingState(false);
  }
}

/**
 * Action: generate_recipe (Mode B: From Available Ingredients)
 */
async function handleGenerateByPantry(e) {
  e.preventDefault();
  if (AppState.isGeneratingRecipe) return;

  const servingsInput = document.getElementById("servings-pantry");
  const servings = parseInt(servingsInput.value, 10) || 2;

  // Validation: Must have at least one ingredient
  if (AppState.pantryIngredients.length === 0) {
    showToast("Please add at least one ingredient to cook with.", "error");
    document.getElementById("pantry-ingredient-input").focus();
    return;
  }

  AppState.currentMode = "pantry";
  setRecipeLoadingState(true);

  // Exact request structure specified in Section 5.2
  const payloadData = {
    message: "",
    servings: servings,
    ingredients: [...AppState.pantryIngredients],
    mode: "pantry"
  };

  try {
    const response = await sendN8NRequest("generate_recipe", payloadData);
    const defaultTitle = `Wok Creation with ${AppState.pantryIngredients.slice(0, 2).join(" & ")}`;
    const parsedRecipe = extractRecipeData(response, defaultTitle, servings);

    if (!parsedRecipe) {
      throw new Error("No usable recipe content was returned by the workflow.");
    }

    AppState.currentRecipe = parsedRecipe;
    renderRecipeResult(parsedRecipe);
    showToast(`Recipe "${parsedRecipe.name}" generated successfully!`, "success");

  } catch (err) {
    console.error("Recipe generation error:", err);
    setRecipeErrorState(err.message);
    showToast(err.message, "error");
  } finally {
    setRecipeLoadingState(false);
  }
}

/**
 * Action: email_recipe (Section 5.5)
 */
async function handleEmailRecipe(e) {
  e.preventDefault();
  if (AppState.isEmailingRecipe) return;

  const emailInput = document.getElementById("email-recipe-input");
  const submitBtn = document.getElementById("btn-submit-email-recipe");
  const email = emailInput.value.trim();

  // Validate recipe availability
  if (!AppState.currentRecipe) {
    setInlineFeedback("email-recipe-feedback", "No recipe is currently available to email.", "error");
    return;
  }

  // Validate email address format
  if (!isValidEmail(email)) {
    setInlineFeedback("email-recipe-feedback", "Please enter a valid email address.", "error");
    emailInput.focus();
    return;
  }

  AppState.isEmailingRecipe = true;
  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  setInlineFeedback("email-recipe-feedback", "");

  // Payload structure as specified in Section 5.5
  const payloadData = {
    email: email,
    recipeName: AppState.currentRecipe.name,
    recipeMarkdown: AppState.currentRecipe.markdown || buildMarkdownFromObject(AppState.currentRecipe),
    recipeId: AppState.currentRecipe.id || null,
    servings: AppState.currentRecipe.servings
  };

  try {
    const response = await sendN8NRequest("email_recipe", payloadData);
    
    // Check application-level success if returned
    if (response && response.success === false) {
      throw new Error(response.message || "Failed to deliver email.");
    }

    setInlineFeedback(
      "email-recipe-feedback", 
      `Recipe successfully emailed to ${email}! Check your inbox.`, 
      "success"
    );
    showToast("Recipe emailed successfully!", "success");
    emailInput.value = "";

  } catch (err) {
    console.error("Email recipe error:", err);
    setInlineFeedback("email-recipe-feedback", err.message, "error");
    showToast(err.message, "error");
  } finally {
    AppState.isEmailingRecipe = false;
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
}

/**
 * Action: rate_recipe (Section 5.6)
 */
async function handleRateRecipe(e) {
  e.preventDefault();
  if (AppState.isSubmittingRating) return;

  const submitBtn = document.getElementById("btn-submit-rating");
  const commentInput = document.getElementById("rating-comment");
  const comment = commentInput.value.trim();

  if (!AppState.currentRecipe) {
    setInlineFeedback("rating-feedback", "No active recipe to rate.", "error");
    return;
  }

  if (AppState.selectedRating < 1 || AppState.selectedRating > 5) {
    setInlineFeedback("rating-feedback", "Please click the stars to select a rating (1-5).", "error");
    return;
  }

  AppState.isSubmittingRating = true;
  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  setInlineFeedback("rating-feedback", "");

  // Payload structure as specified in Section 5.6
  const isoTimestamp = new Date().toISOString();
  const payloadData = {
    recipeId: AppState.currentRecipe.id || null,
    recipeName: AppState.currentRecipe.name,
    rating: AppState.selectedRating,
    comment: comment
  };

  try {
    const response = await sendN8NRequest("rate_recipe", payloadData, isoTimestamp);

    if (response && response.success === false) {
      throw new Error(response.message || "Failed to save rating.");
    }

    setInlineFeedback(
      "rating-feedback", 
      `Thank you! Your ${AppState.selectedRating}-star rating and feedback were submitted.`, 
      "success"
    );
    showToast("Rating submitted successfully!", "success");

  } catch (err) {
    console.error("Rate recipe error:", err);
    setInlineFeedback("rating-feedback", err.message, "error");
    showToast(err.message, "error");
  } finally {
    AppState.isSubmittingRating = false;
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
}

/**
 * Action: email_shopping_list (Section 5.4)
 */
async function handleEmailShoppingList(e) {
  e.preventDefault();
  if (AppState.isEmailingShoppingList) return;

  const emailInput = document.getElementById("shopping-email-input");
  const submitBtn = document.getElementById("btn-submit-email-shopping");
  const email = emailInput.value.trim();

  if (AppState.shoppingList.length === 0) {
    setInlineFeedback("email-shopping-feedback", "Your shopping list is empty. Add items first.", "error");
    return;
  }

  if (!isValidEmail(email)) {
    setInlineFeedback("email-shopping-feedback", "Please enter a valid email address.", "error");
    emailInput.focus();
    return;
  }

  AppState.isEmailingShoppingList = true;
  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  setInlineFeedback("email-shopping-feedback", "");

  // Payload structure as specified in Section 5.4
  const payloadData = {
    email: email,
    items: AppState.shoppingList.map(item => ({
      name: item.name,
      quantity: item.quantity || "",
      completed: !!item.completed
    }))
  };

  try {
    const response = await sendN8NRequest("email_shopping_list", payloadData);

    if (response && response.success === false) {
      throw new Error(response.message || "Failed to send shopping list.");
    }

    setInlineFeedback(
      "email-shopping-feedback", 
      `Shopping list (${AppState.shoppingList.length} items) sent to ${email}!`, 
      "success"
    );
    showToast("Shopping list emailed successfully!", "success");
    emailInput.value = "";

  } catch (err) {
    console.error("Email shopping list error:", err);
    setInlineFeedback("email-shopping-feedback", err.message, "error");
    showToast(err.message, "error");
  } finally {
    AppState.isEmailingShoppingList = false;
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
  }
}

// ----------------------------------------------------------------------------
// 11. Event Listeners & Initialization
// ----------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  // 1. Initialize Webhook UI
  updateWebhookStatusUI();

  // 2. Load and render shopping list from localStorage
  loadShoppingListFromStorage();
  renderShoppingList();
  renderPantryTags();

  // --------------------------------------------------------------------------
  // Tab Switching (Mode A vs Mode B)
  // --------------------------------------------------------------------------
  const tabName = document.getElementById("tab-mode-name");
  const tabPantry = document.getElementById("tab-mode-pantry");
  const panelName = document.getElementById("panel-mode-name");
  const panelPantry = document.getElementById("panel-mode-pantry");

  tabName.addEventListener("click", () => {
    tabName.classList.add("active");
    tabName.setAttribute("aria-selected", "true");
    tabPantry.classList.remove("active");
    tabPantry.setAttribute("aria-selected", "false");

    panelName.classList.add("active");
    panelPantry.classList.remove("active");
    AppState.currentMode = "by_name";
  });

  tabPantry.addEventListener("click", () => {
    tabPantry.classList.add("active");
    tabPantry.setAttribute("aria-selected", "true");
    tabName.classList.remove("active");
    tabName.setAttribute("aria-selected", "false");

    panelPantry.classList.add("active");
    panelName.classList.remove("active");
    AppState.currentMode = "pantry";
  });

  // --------------------------------------------------------------------------
  // Servings Steppers
  // --------------------------------------------------------------------------
  const setupStepper = (decreaseBtnId, increaseBtnId, inputId) => {
    const decBtn = document.getElementById(decreaseBtnId);
    const incBtn = document.getElementById(increaseBtnId);
    const input = document.getElementById(inputId);

    decBtn.addEventListener("click", () => {
      let val = parseInt(input.value, 10) || 2;
      if (val > 1) {
        input.value = val - 1;
      }
    });

    incBtn.addEventListener("click", () => {
      let val = parseInt(input.value, 10) || 2;
      if (val < 12) {
        input.value = val + 1;
      }
    });
  };

  setupStepper("btn-decrease-servings-name", "btn-increase-servings-name", "servings-name");
  setupStepper("btn-decrease-servings-pantry", "btn-increase-servings-pantry", "servings-pantry");

  // --------------------------------------------------------------------------
  // Mode A Suggestion Chips
  // --------------------------------------------------------------------------
  document.querySelectorAll(".chip-suggestion").forEach(chip => {
    chip.addEventListener("click", () => {
      const dish = chip.getAttribute("data-dish");
      const input = document.getElementById("dish-name-input");
      input.value = dish;
      input.focus();
    });
  });

  // --------------------------------------------------------------------------
  // Mode B Pantry Add & Staples Chips
  // --------------------------------------------------------------------------
  const pantryInput = document.getElementById("pantry-ingredient-input");
  const btnAddPantry = document.getElementById("btn-add-pantry-ingredient");

  const commitPantryInput = () => {
    const val = pantryInput.value.trim();
    if (val) {
      addPantryIngredient(val);
      pantryInput.value = "";
    }
  };

  btnAddPantry.addEventListener("click", commitPantryInput);
  pantryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitPantryInput();
    }
  });

  document.querySelectorAll(".chip-pantry").forEach(chip => {
    chip.addEventListener("click", () => {
      const item = chip.getAttribute("data-item");
      addPantryIngredient(item);
    });
  });

  // Remove tag event delegation
  document.getElementById("pantry-tags-container").addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-remove-tag")) {
      const idx = parseInt(e.target.getAttribute("data-index"), 10);
      removePantryIngredient(idx);
    }
  });

  // Clear all pantry ingredients
  document.getElementById("btn-clear-all-ingredients").addEventListener("click", () => {
    AppState.pantryIngredients = [];
    renderPantryTags();
  });

  // --------------------------------------------------------------------------
  // Recipe Generation Forms (Section 5.2)
  // --------------------------------------------------------------------------
  document.getElementById("form-by-name").addEventListener("submit", handleGenerateByName);
  document.getElementById("form-by-pantry").addEventListener("submit", handleGenerateByPantry);

  document.getElementById("btn-retry-recipe").addEventListener("click", () => {
    if (AppState.currentMode === "pantry") {
      document.getElementById("form-by-pantry").dispatchEvent(new Event("submit"));
    } else {
      document.getElementById("form-by-name").dispatchEvent(new Event("submit"));
    }
  });

  // --------------------------------------------------------------------------
  // Recipe Result Toolbar Actions
  // --------------------------------------------------------------------------
  document.getElementById("btn-add-all-to-shopping").addEventListener("click", importRecipeIngredientsToShoppingList);

  document.getElementById("btn-copy-recipe").addEventListener("click", () => {
    if (!AppState.currentRecipe) return;
    const textToCopy = AppState.currentRecipe.markdown || buildMarkdownFromObject(AppState.currentRecipe);
    navigator.clipboard.writeText(textToCopy)
      .then(() => showToast("Recipe copied to clipboard!", "success"))
      .catch(() => showToast("Could not copy recipe to clipboard.", "error"));
  });

  // --------------------------------------------------------------------------
  // Email Recipe Form (Section 5.5)
  // --------------------------------------------------------------------------
  document.getElementById("form-email-recipe").addEventListener("submit", handleEmailRecipe);

  // --------------------------------------------------------------------------
  // Rate Recipe Form & Interactive Stars (Section 5.6)
  // --------------------------------------------------------------------------
  const starButtons = document.querySelectorAll("#star-rating-control .star-btn");
  starButtons.forEach((star) => {
    star.addEventListener("click", () => {
      const val = parseInt(star.getAttribute("data-value"), 10);
      AppState.selectedRating = val;
      updateRatingStars(val);
    });

    star.addEventListener("mouseenter", () => {
      const val = parseInt(star.getAttribute("data-value"), 10);
      starButtons.forEach((s, idx) => {
        if (idx < val) s.classList.add("hover");
        else s.classList.remove("hover");
      });
    });
  });

  document.getElementById("star-rating-control").addEventListener("mouseleave", () => {
    starButtons.forEach(s => s.classList.remove("hover"));
  });

  document.getElementById("form-rate-recipe").addEventListener("submit", handleRateRecipe);

  // --------------------------------------------------------------------------
  // Shopping List Forms & Events (Section 5.4)
  // --------------------------------------------------------------------------
  document.getElementById("form-add-shopping-item").addEventListener("submit", (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("shopping-item-name");
    const qtyInput = document.getElementById("shopping-item-qty");

    const name = nameInput.value.trim();
    const qty = qtyInput.value.trim();

    if (!name) {
      showToast("Please enter an item name.", "error");
      nameInput.focus();
      return;
    }

    addShoppingListItem(name, qty);
    nameInput.value = "";
    qtyInput.value = "";
    nameInput.focus();
  });

  // Shopping list item interactions (checkbox & delete)
  document.getElementById("shopping-list-ul").addEventListener("click", (e) => {
    if (e.target.classList.contains("shopping-item-checkbox")) {
      const idx = parseInt(e.target.getAttribute("data-index"), 10);
      toggleShoppingItem(idx);
    } else if (e.target.classList.contains("btn-delete-item")) {
      const idx = parseInt(e.target.getAttribute("data-index"), 10);
      deleteShoppingItem(idx);
    }
  });

  document.getElementById("btn-clear-completed").addEventListener("click", clearCompletedShoppingItems);
  document.getElementById("btn-clear-shopping-list").addEventListener("click", clearAllShoppingItems);

  // Email Shopping List Form (Section 5.4)
  document.getElementById("form-email-shopping").addEventListener("submit", handleEmailShoppingList);

  // --------------------------------------------------------------------------
  // Settings / Webhook Modal Management
  // --------------------------------------------------------------------------
  const settingsModal = document.getElementById("settings-modal");
  const webhookInput = document.getElementById("webhook-url-input");

  const openSettings = () => {
    const currentUrl = getWebhookUrl();
    webhookInput.value = (currentUrl === "PASTE_YOUR_N8N_WEBHOOK_URL_HERE") ? "" : currentUrl;
    settingsModal.classList.remove("hidden");
    webhookInput.focus();
  };

  const closeSettings = () => {
    settingsModal.classList.add("hidden");
  };

  document.getElementById("btn-open-settings").addEventListener("click", openSettings);
  document.getElementById("btn-notice-configure").addEventListener("click", openSettings);
  document.getElementById("btn-close-settings").addEventListener("click", closeSettings);

  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  document.getElementById("btn-save-webhook").addEventListener("click", () => {
    const newUrl = webhookInput.value.trim();
    if (newUrl.length > 0) {
      localStorage.setItem("chinese_chef_n8n_webhook_url", newUrl);
      showToast("n8n Webhook URL updated successfully!", "success");
    } else {
      localStorage.removeItem("chinese_chef_n8n_webhook_url");
      showToast("Reset to default webhook placeholder.", "info");
    }
    updateWebhookStatusUI();
    closeSettings();
  });

  document.getElementById("btn-reset-webhook").addEventListener("click", () => {
    localStorage.removeItem("chinese_chef_n8n_webhook_url");
    webhookInput.value = "";
    updateWebhookStatusUI();
    showToast("Reset to default configuration.", "info");
    closeSettings();
  });

  document.getElementById("btn-dismiss-notice").addEventListener("click", () => {
    document.getElementById("webhook-notice-banner").classList.add("hidden");
    sessionStorage.setItem("dismissed_webhook_notice", "true");
  });
});
