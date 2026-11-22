# Chinese AI Chef --- Frontend Requirements

**Project type:** Frontend-only web application\
**Implementation:** HTML5, CSS3, Vanilla JavaScript\
**Backend:** Existing n8n workflow\
**Deployment:** Not required at this stage

------------------------------------------------------------------------

## 1. Project Overview

Build a simple, responsive web frontend for **Chinese AI Chef**. The
application allows users to generate Chinese recipes, create and email
shopping lists, email recipes, and submit recipe ratings.

The backend and AI workflow already exist in n8n. The frontend must
communicate with that existing workflow through its webhook.

### Core rule

**Build only the frontend. Do not recreate, replace, or modify the
existing n8n backend.**

Do not deploy the application. The immediate goal is to create and
locally test the frontend.

------------------------------------------------------------------------

## 2. Technology Requirements

Use only:

-   HTML5 for page structure
-   CSS3 for styling and responsive layouts
-   Vanilla JavaScript for interactions and API requests
-   Fetch API for communication with n8n

Do not use:

-   React, Vue, Angular, or another frontend framework
-   Tailwind CSS, Bootstrap, or another CSS framework
-   A new backend or database
-   Unnecessary libraries or build tools

Keep the code readable and suitable for a beginner to understand and
maintain.

------------------------------------------------------------------------

## 3. Project Structure

Create and maintain this structure:

``` text
chinese-ai-chef/
│
├── index.html
├── css/
│   └── style.css
│
├── js/
│   └── script.js
│
└── assets/
    └── images/
```

Keep HTML, CSS, and JavaScript in their respective files. Do not place
the entire application in one HTML file.

------------------------------------------------------------------------

## 4. Design Direction

Create a modern, welcoming cooking assistant interface inspired by
Chinese cuisine.

### Suggested visual style

-   Warm cream or off-white background
-   Deep red or maroon as the main accent
-   Dark charcoal text
-   Subtle borders and shadows
-   Rounded cards and buttons
-   Clear typography and comfortable spacing
-   Food photography where appropriate

The interface should feel polished but remain simple and easy to use.

### Responsive behaviour

The layout must work on: - Desktop screens - Tablets - Mobile phones

Avoid excessive animations, clutter, and complicated navigation.

------------------------------------------------------------------------

## 5. Main Features

### 5.1 Home / Main Chef Interface

Create a clear landing area that introduces Chinese AI Chef and guides
the user toward generating a recipe.

Include: - Application name and short introduction - A clear
recipe-generation area - Easy access to the shopping list and other
recipe actions

### 5.2 Recipe Generation

Provide two recipe-generation modes.

#### Mode A --- Generate by Dish Name

Inputs: - Dish or recipe name - Number of servings

Action: - A **Generate Recipe** button

Send the request to n8n with the `generate_recipe` action and
`mode: "by_name"`.

Example request:

``` json
{
  "action": "generate_recipe",
  "data": {
    "message": "Chicken Manchurian",
    "servings": 2,
    "ingredients": [],
    "mode": "by_name"
  }
}
```

#### Mode B --- Generate from Available Ingredients

Inputs: - Ingredient entry field - A way to add multiple ingredients - A
visible list of added ingredients - A way to remove an ingredient -
Number of servings

Action: - A **Generate Recipe** button

Send the request to n8n with the `generate_recipe` action and
`mode: "pantry"`.

Example request:

``` json
{
  "action": "generate_recipe",
  "data": {
    "message": "",
    "servings": 2,
    "ingredients": ["chicken", "onion", "garlic"],
    "mode": "pantry"
  }
}
```

The frontend should validate that the user has entered a dish name or at
least one ingredient, depending on the selected mode.

### 5.3 Recipe Results

Show the generated recipe in a clear, readable results area.

Display the information available in the response, such as: - Recipe
title - Description - Ingredients - Cooking steps - Cooking tips -
Serving suggestions

The existing n8n workflow may return recipe text through fields such as
`text`, `reply`, `response`, `output`, or `recipe`. Write defensive
response-handling code so the frontend can extract and display the
available result without assuming that every field is present.

Do not invent recipe content or show mock results as if they came from
the AI. Show a clear error or empty state if no usable recipe is
returned.

### 5.4 Shopping List

Provide a shopping-list interface where users can: - Add an item - Enter
an item's quantity - Remove an item - Mark an item as completed - Enter
an email address - Email the shopping list

Connect the email action to `email_shopping_list`.

Example request:

``` json
{
  "action": "email_shopping_list",
  "data": {
    "email": "user@example.com",
    "items": [
      {
        "name": "Chicken",
        "quantity": "500g",
        "completed": false
      }
    ]
  }
}
```

The `items` array should contain the current shopping-list items and
their completion status.

### 5.5 Email Recipe

Provide an email input and an **Email Recipe** button for the currently
displayed recipe.

Connect this feature to the `email_recipe` action. Send the email
address and the available recipe data using the field names expected by
the existing workflow, including `recipeName` and `recipeMarkdown` where
available.

Do not send an empty or unavailable recipe as though it were valid.
Validate the email address before sending.

### 5.6 Recipe Rating

Provide: - A five-star rating control - An optional feedback/comment
field - A submit button

Connect this feature to the `rate_recipe` action.

Use the following payload structure, matching the existing workflow's
expected fields:

``` json
{
  "action": "rate_recipe",
  "timestamp": "ISO_TIMESTAMP",
  "data": {
    "recipeId": "RECIPE_ID",
    "recipeName": "Chicken Manchurian",
    "rating": 5,
    "comment": "Very delicious and easy to prepare."
  }
}
```

Use the current recipe's available ID and name when present. Do not
fabricate an ID if the workflow does not provide one; inspect the
existing workflow behaviour and handle the missing ID appropriately.

------------------------------------------------------------------------

## 6. n8n API Integration

The existing n8n workflow exposes a webhook that accepts POST requests
and routes requests according to `body.action`.

Supported actions:

  Action                  Purpose
  ----------------------- -----------------------------------
  `generate_recipe`       Generate a recipe
  `email_shopping_list`   Email the shopping list
  `email_recipe`          Email a recipe
  `rate_recipe`           Save a recipe rating and feedback

### Webhook configuration

For the initial local frontend, define one clearly named configuration
value in JavaScript for the n8n webhook URL.

Example placeholder:

``` javascript
const N8N_WEBHOOK_URL = "PASTE_YOUR_N8N_WEBHOOK_URL_HERE";
```

Do not invent a webhook URL. The actual URL will be supplied separately.

Keep the webhook URL in one place so it can be changed easily. Do not
expose API keys, passwords, or other credentials in frontend code.

### Request behaviour

Use `fetch()` to send POST requests with a JSON body.

The request should: - Use the configured webhook URL - Send the correct
action and data structure - Parse the response safely - Check HTTP and
application-level success - Handle invalid or non-JSON responses without
crashing

The n8n webhook currently uses a response node and includes an
`Access-Control-Allow-Origin: *` header in its responses. If browser
requests fail because of CORS or preflight behaviour, report the exact
issue. Do not silently change the backend or claim that the request
succeeded.

------------------------------------------------------------------------

## 7. User Experience and Error Handling

Every action that communicates with n8n must provide clear feedback.

Implement: - Loading state while a request is running - Disable the
relevant submit button during the request - Success message only after a
confirmed successful response - Useful error message if the request
fails - Required-field validation - Email-format validation -
Empty-state messages where appropriate

Prevent duplicate submissions while a request is in progress.

Do not display fake success messages or hardcoded API results.

------------------------------------------------------------------------

## 8. Code Quality

-   Use semantic HTML elements.
-   Use meaningful class names and JavaScript function names.
-   Keep functions focused and avoid unnecessary duplication.
-   Separate API communication from UI rendering where practical.
-   Add short comments around important logic, especially the n8n
    request handling.
-   Avoid unnecessary complexity.
-   Ensure the browser console has no avoidable errors.
-   Do not add features that are not listed in this document.

------------------------------------------------------------------------

## 9. Development Order

Work in the following order:

1.  Inspect the project folder and create the required file structure.
2.  Build the page layout and visual design in HTML and CSS.
3.  Implement the dish-name recipe form.
4.  Implement the pantry-ingredient recipe form.
5.  Implement recipe result rendering.
6.  Implement shopping-list interactions.
7.  Implement email-recipe and email-shopping-list actions.
8.  Implement recipe rating.
9.  Connect all four actions to the existing n8n webhook.
10. Test validation, loading, success, and error states.

If the webhook URL is not yet available, finish the interface and keep
the integration configuration as a clearly marked placeholder. Do not
pretend that live API integration has been tested.

------------------------------------------------------------------------

## 10. Scope Restrictions

For this phase:

-   Do not deploy or publish the application.
-   Do not create a database.
-   Do not create a new backend.
-   Do not rebuild the AI recipe-generation logic.
-   Do not modify the existing n8n workflow without asking first.
-   Do not add authentication or user accounts.
-   Do not add unrelated features.
-   Do not use mock data as real backend output.

------------------------------------------------------------------------

## 11. Completion Checklist

The frontend phase is complete when:

-   [ ] The application runs locally in a browser.
-   [ ] The page is responsive on desktop and mobile.
-   [ ] Users can generate recipes by dish name.
-   [ ] Users can generate recipes from available ingredients.
-   [ ] Recipe results display the available response content.
-   [ ] Users can add, remove, and complete shopping-list items.
-   [ ] Users can email a shopping list.
-   [ ] Users can email the current recipe.
-   [ ] Users can submit a recipe rating and optional feedback.
-   [ ] All four actions use the correct n8n action names and payload
    structures.
-   [ ] Loading, validation, success, and error states work.
-   [ ] No deployment or backend replacement has been performed.

**Final instruction:** Build a simple, polished frontend that integrates
with the existing n8n workflow. Prioritize correct functionality,
readable code, and a clean user experience over unnecessary complexity.
