function trait(value) {
  return {value};
}

function node(name, div, numDate, traits, children) {
  const value = {
    name,
    node_attrs: {
      div,
      num_date: {value: numDate},
      ...Object.fromEntries(Object.entries(traits).map(([key, traitValue]) => [key, trait(traitValue)]))
    }
  };
  if (children?.length) value.children = children;
  return value;
}

export const demoDataset = {
  version: "v2",
  meta: {
    title: "Demo respiratory-virus phylogeny",
    updated: "2026-07-17",
    panels: ["tree"],
    description: "Synthetic data bundled with the local viewer. It contains no real samples.",
    colorings: [
      {key: "region", title: "Region", type: "categorical"},
      {key: "country", title: "Country", type: "categorical"},
      {key: "clade", title: "Clade", type: "categorical"},
      {key: "host", title: "Host", type: "categorical"}
    ],
    filters: ["region", "country", "clade", "host"]
  },
  tree: node("ROOT", 0, 2020.0, {region: "Global", country: "Multiple", clade: "Root", host: "Human"}, [
    node("NODE_A", 0.10, 2020.25, {region: "Americas", country: "Multiple", clade: "A", host: "Human"}, [
      node("NODE_A1", 0.24, 2020.75, {region: "North America", country: "Multiple", clade: "A.1", host: "Human"}, [
        node("A/USA/001", 0.42, 2021.12, {region: "North America", country: "USA", clade: "A.1", host: "Human"}),
        node("A/USA/002", 0.48, 2021.44, {region: "North America", country: "USA", clade: "A.1", host: "Human"}),
        node("A/MEX/003", 0.52, 2021.83, {region: "North America", country: "Mexico", clade: "A.1", host: "Human"})
      ]),
      node("NODE_A2", 0.31, 2021.05, {region: "South America", country: "Multiple", clade: "A.2", host: "Human"}, [
        node("A/BRA/004", 0.59, 2022.14, {region: "South America", country: "Brazil", clade: "A.2", host: "Human"}),
        node("A/CHL/005", 0.63, 2022.48, {region: "South America", country: "Chile", clade: "A.2", host: "Human"})
      ])
    ]),
    node("NODE_B", 0.15, 2020.42, {region: "Multiple", country: "Multiple", clade: "B", host: "Human"}, [
      node("NODE_B1", 0.39, 2021.18, {region: "Europe", country: "Multiple", clade: "B.1", host: "Human"}, [
        node("B/FRA/006", 0.67, 2022.31, {region: "Europe", country: "France", clade: "B.1", host: "Human"}),
        node("B/DEU/007", 0.70, 2022.66, {region: "Europe", country: "Germany", clade: "B.1", host: "Human"}),
        node("B/GBR/008", 0.76, 2023.02, {region: "Europe", country: "United Kingdom", clade: "B.1", host: "Human"})
      ]),
      node("NODE_B2", 0.45, 2021.52, {region: "Africa", country: "Multiple", clade: "B.2", host: "Human"}, [
        node("B/KEN/009", 0.73, 2022.72, {region: "Africa", country: "Kenya", clade: "B.2", host: "Human"}),
        node("B/ZAF/010", 0.82, 2023.20, {region: "Africa", country: "South Africa", clade: "B.2", host: "Human"}),
        node("B/NGA/011", 0.88, 2023.57, {region: "Africa", country: "Nigeria", clade: "B.2", host: "Human"})
      ])
    ]),
    node("NODE_C", 0.22, 2021.0, {region: "Asia-Pacific", country: "Multiple", clade: "C", host: "Human"}, [
      node("NODE_C1", 0.54, 2021.94, {region: "Asia-Pacific", country: "Multiple", clade: "C.1", host: "Human"}, [
        node("C/JPN/012", 0.86, 2023.34, {region: "Asia-Pacific", country: "Japan", clade: "C.1", host: "Human"}),
        node("C/KOR/013", 0.91, 2023.62, {region: "Asia-Pacific", country: "South Korea", clade: "C.1", host: "Human"}),
        node("C/AUS/014", 0.95, 2023.91, {region: "Oceania", country: "Australia", clade: "C.1", host: "Human"})
      ]),
      node("NODE_C2", 0.60, 2022.38, {region: "Multiple", country: "Multiple", clade: "C.2", host: "Human"}, [
        node("C/IND/015", 0.96, 2024.12, {region: "Asia-Pacific", country: "India", clade: "C.2", host: "Human"}),
        node("C/SGP/016", 1.02, 2024.38, {region: "Asia-Pacific", country: "Singapore", clade: "C.2", host: "Human"}),
        node("C/CAN/017", 1.08, 2024.61, {region: "North America", country: "Canada", clade: "C.2", host: "Human"})
      ])
    ])
  ])
};
