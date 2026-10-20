// Edit this file to fill in the About page. Empty lists hide their section.

export interface Profile {
  name: string;
  headline: string;
  intro: string;
  links: { label: string; url: string }[];
  experience: { role: string; organization: string; period: string; description: string }[];
  projects: { name: string; url?: string; description: string; tags: string[] }[];
}

export const profile: Profile = {
  name: "Hack-Ray",
  headline: "",
  intro: "",
  links: [
    { label: "GitHub", url: "https://github.com/Hack-Ray" },
    // { label: "LinkedIn", url: "https://www.linkedin.com/in/<id>" },
    // { label: "Email", url: "mailto:<address>" },
  ],
  experience: [],
  projects: [],
};
