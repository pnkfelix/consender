import { mount } from "./view.js";

console.log("[consender] main.ts loaded");
const app = document.getElementById("app");
console.log("[consender] #app element:", app);
if (!app) {
  console.error("[consender] #app not found in DOM");
} else {
  mount(app);
}
