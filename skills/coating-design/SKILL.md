---
name: coating-design
description: Designs and checks optical thin-film coatings (antireflection coatings, mirrors, beam splitters, edge, bandpass and dichroic filters) through TFStudio's MCP tools, from the requirement to a saved .tfs file. Covers choosing materials, a starting stack, the merit function, refinement and synthesis, a stack a coater can make, the specification and the manufacturing yield. Use when the user asks for a coating design or a layer stack, or for work on a TFStudio design.
compatibility: Needs TFStudio's MCP server, which TFStudio serves when started with --mcp (https://tfstudio.xyz).
---

# Designing a coating with TFStudio

Each tool's description says what it takes and what it answers. This is the order to use them in. Tool names are in backticks.

## 1. Get the requirement

Before calling a tool, know each band in nm and the R, T or A it needs; the angle of incidence and the polarization; the substrate, the incident medium and which side is coated; the materials the user can deposit; and the thinnest layer their coater makes. Ask for what is missing. Do not choose materials the user has not said they can deposit.

## 2. Check the materials

`findMaterials` gives the id of each film, the substrate and the media. `materialNK` across the band gives n and k and where the data end. A film with k above 0 in the band holds R of a mirror and T of a pass band below 1, and no weight in the merit function gets past that.

## 3. Start a design

`newDesign` with the substrate, the media, the surface mode and the reference wavelength at the centre of the band that matters most. `stackFromFormula` builds the start from quarter waves at the reference wavelength, the first letter on the substrate, with symbols naming the user's high and low index materials:

- a mirror or a stop band: '(HL)^5 H'; more periods reflect more
- a single-cavity bandpass: '(HL)^4 2H (LH)^4'
- an antireflection coating: 'L', one quarter wave, which synthesis grows
- a non-polarizing edge at an angle: `edgeFilter` with the user's materials as a and b searches the periods, and `applyEdgeFilter` puts one in

## 4. Write the merit function

`setMerit` with one row per requirement, at each angle and polarization the part sees. T, R and A targets are fractions of 1. Use a band average (TAV, RAV) where the mean over the band matters, and a worst-case row (TMN, RMX and the others) where every wavelength has to meet it. Give a narrow feature, such as a cavity's pass band, a flag, so the band's grid does not step over it. Leave the thickness floor out for now. `merit` gives each row's value, and `spectrum` with values true gives the curve.

## 5. Refine, then add layers

`refine` with method 'dls' moves the thicknesses and keeps the layers. If the merit stops falling while still far from the targets, the stack often has too few layers: `synthesize` with method 'needle' and the user's materials as the pool, then 'ge' if needle stops gaining. 'structural' reaches a merit with fewer layers. 'deep' searches globally from the side's layers, or from nothing on a side with no layers. If the stack should be able to meet the targets as it is, the run may have stopped in a local minimum: `refine` with method 'dls-multi' starts again from several places.

`refine`, `synthesize` and `monteCarlo` run as jobs: they answer with the job's state, and `jobStatus` follows one still running. A run that changed the design answers with a new design id; go on from that id.

## 6. Make it buildable

Synthesis leaves thin layers and touching layers of one material. `cleanDesign` with minThickness at the thinnest layer the coater makes merges the touching layers and takes out the thinner ones. Then `setMerit` with the rows again, since it replaces every row, plus an MNT row with that thickness as its target, and `refine` with method 'sqp', which keeps every layer at or above it.

## 7. Check the specification

`setSpecification` with the user's requirements as pass or fail checks; `checkSpecification` gives each check's value and its margin to the bound. The design is done when every check passes, not when the merit is low. A failing check needs a heavier row, a row of its own, or more layers.

## 8. Estimate the yield

`monteCarlo` with the coater's thickness error (ask for it; the tool's default is 1 %) gives the spread of the spectrum and, with a specification set, the share of parts that pass. `layerSensitivity` ranks the layers whose errors cost most, the ones the coater has to hold tightest.

## 9. Hand it over

`saveDesign` to an absolute path the user names. Report the layer count and total thickness (`designFacts`), each check with its margin and the yield. Give R and T in percent, as the app shows them.
