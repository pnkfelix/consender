import { mount } from "./view.js";

if (localStorage.getItem("consender-theme") === "dark") {
  document.documentElement.dataset.theme = "dark";
}

console.log("[consender] main.ts loaded");
const app = document.getElementById("app");
console.log("[consender] #app element:", app);
if (!app) {
  console.error("[consender] #app not found in DOM");
} else {
  mount(app);
}
