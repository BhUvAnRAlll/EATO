// Where to find each value on a brand's result sheet. Adding a brand means adding a
// layout here; the calculation code never changes. Brands are named only as formats.

const reportLayouts = {
  inbody: {
    label: "InBody result sheet",
    hints: [
      "The test date and time are in the header next to the ID, height, age and gender.",
      'Weight, Body Fat Mass and Skeletal Muscle Mass (SMM) appear in "Body Composition Analysis" and "Muscle-Fat Analysis".',
      'Percent Body Fat (PBF) is in "Obesity Analysis".',
      'Fat Free Mass, Basal Metabolic Rate and Recommended calorie intake are usually in "Research Parameters" or the side panel.',
      '"Segmental Lean Analysis" and "Segmental Fat Analysis" show a body diagram with five regions (Right Arm, Left Arm, Trunk, Right Leg, Left Leg); each has a mass figure and a rating (Under, Normal or Over). Copy the mass, not the percentage printed beside it.',
      'Use each measured value, never the "Normal range" limits, bar-chart scale numbers or the "Body Composition History" of older tests.',
    ].join("\n"),
  },
};

module.exports = { reportLayouts };
