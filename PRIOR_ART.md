# Prior Art

Research and existing systems relevant to mycelium's vision.

## 1. Neuro-Symbolic Program Synthesis

Combines neural networks with symbolic reasoning for code generation.

**Key ideas:**
- Neurosymbolic programs invoke neural nets as library routines
- Symbolic structures (graphs, constraints, types) + neural models share state
- GNNs (Graph Neural Networks) for program analysis and synthesis
- Neural guides symbolic search; symbolic constrains neural output

**References:**
- [Neurosymbolic Programming (UT Austin)](https://www.cs.utexas.edu/~swarat/pubs/PGL-049-Plain.pdf)
- [SIGPLAN Blog: Synthesizing Neurosymbolic Programs](https://blog.sigplan.org/2020/04/15/synthesizing-neurosymbolic-programs/)
- [NSF Foundations & Trends](https://par.nsf.gov/servlets/purl/10428593)
- [MIT CSAIL Neuro-Symbolic Visual Reasoning](http://nscv.csail.mit.edu/)

**Relevance to mycelium:** The graph is the symbolic layer; LLMs provide the neural layer. Division of labor: LLMs reason, tools verify.

---

## 2. Dataflow / Visual Programming

Block diagrams with wires representing data flow between operations.

**Key ideas:**
- Operations are black boxes with explicit inputs/outputs
- Execution when all inputs available (inherently parallel)
- No shared state, no side effects between blocks
- Pioneered by Jack Dennis at MIT (1960s)

**Notable systems:**
- **LabVIEW** (1986) - Graphical dataflow for engineers/scientists
- **Node-RED** - Flow-based rapid development for IoT
- **Pure Data** - Visual programming for multimedia/audio
- **Unreal Blueprints** - Node-based visual scripting for games
- **KNIME** - Data analytics and integration

**References:**
- [Dataflow Programming (Wikipedia)](https://en.wikipedia.org/wiki/Dataflow_programming)
- [Flow-based Programming (Wikipedia)](https://en.wikipedia.org/wiki/Flow-based_programming)
- [Visual Programming Languages (Wikipedia)](https://en.wikipedia.org/wiki/Visual_programming_language)

**Relevance to mycelium:** The recursive box model with ports is essentially dataflow. Nodes have inputs/outputs, edges connect ports.

---

## 3. Model-Driven Architecture (MDA)

OMG standard for generating code from platform-independent models.

**Key ideas:**
- Platform-Independent Model (PIM) → Platform-Specific Model (PSM) → Code
- Models are the primary artifact, code is derived
- Executable UML / fUML - models that execute directly
- QVT (Query/View/Transformation) for model transformations

**Notable systems:**
- **Eclipse Modeling Framework (EMF)**
- **MetaEdit+**
- **Xtext** - DSL development

**References:**
- [OMG Model-Driven Architecture](https://www.omg.org/mda/)
- [Executable UML in MDA](https://www.informit.com/articles/article.aspx?p=28274&seqNum=6)
- [MDA Books](https://modeling-languages.com/list-mddmda-books/)

**Relevance to mycelium:** Same thesis - models are primary, code is derived. MDA attempted this with UML; we attempt it with intent graphs.

---

## 4. Content-Addressed Code (Unison)

Code identified by hash of its AST, not by names or file paths.

**Key ideas:**
- Each definition has a unique 512-bit SHA3 hash
- Hash based on structure, not variable names or formatting
- Names are pointers to hashes (like Git tags)
- Immutable definitions - contents at an address never change
- Eliminates builds, dependency conflicts, diamond dependency problem

**Benefits:**
- Distributed programming simplified (ship bytecode tree, sync missing hashes)
- No "which version" conflicts - both versions coexist
- Code stored in database, not text files
- Already type-checked and parsed

**References:**
- [Unison: The Big Idea](https://www.unison-lang.org/docs/the-big-idea/)
- [Unison GitHub](https://github.com/unisonweb/unison)
- [LWN: Programming in Unison](https://lwn.net/Articles/978955/)
- [SoftwareMill: Unison Code as Hashes](https://softwaremill.com/trying-out-unison-part-1-code-as-hashes/)

**Relevance to mycelium:** Content-addressing could apply to graph nodes. Hash the structure, not the names. Enables distributed collaboration, no merge conflicts on structure.

---

## 5. Synchronous Reactive Languages

Formal languages for safety-critical embedded systems.

**Key ideas:**
- Synchronous hypothesis: outputs conceptually simultaneous with inputs
- Formal semantics enable verification and correct-by-construction compilation
- Deterministic concurrency
- Compile to finite state machines or efficient sequential code

**Notable languages:**
- **Lustre** (1984) - Declarative dataflow, basis of SCADE
- **Esterel** (1983) - Imperative synchronous language
- **Signal** - Dataflow with multi-clock
- **Statecharts** - Hierarchical state machines

**Applications:**
- Aerospace (Airbus fly-by-wire)
- Automotive (engine control)
- Nuclear plants
- Railway signaling

**References:**
- [Lustre (Wikipedia)](https://en.wikipedia.org/wiki/Lustre_(programming_language))
- [Lustre IEEE Paper](https://ieeexplore.ieee.org/document/97300/)
- [Esterel Paper](http://www.inf.fu-berlin.de/lehre/SS13/Sem-Prog/material/ESTEREL.pdf)

**Relevance to mycelium:** Formal semantics, simulation before deployment, hierarchical abstraction. SCADE proves industrial viability of graph → code.

---

## 6. Industrial Block Diagram Tools

Production tools for embedded code generation from block diagrams.

**Notable systems:**

### Simulink (MathWorks)
- Block diagram environment for Model-Based Design
- Generates C, C++, CUDA, PLC, Verilog, VHDL
- Embedded Coder for production-quality code
- Used in automotive, aerospace, robotics

### SCADE (Ansys)
- Based on Lustre synchronous language
- Qualified for DO-178C (aerospace), ISO 26262 (automotive)
- Formal verification integrated
- Used by Airbus, Boeing, automotive OEMs

**References:**
- [Simulink](https://www.mathworks.com/products/simulink.html)
- [Embedded Coder](https://www.mathworks.com/help/ecoder/gs/code-generation-workflows-with-embedded-coder.html)

**Relevance to mycelium:** Proves the model: block diagrams → production code works at scale. Hierarchical, simulatable, verifiable.

---

## 7. Intentional Programming (Simonyi)

Programs stored as intention trees, not text files.

**Key ideas:**
- Programmer builds domain-specific language environment
- Domain experts describe intended behavior
- System generates final code from description
- Achieved "complete self-sufficiency" (IP built in IP) in 1995
- 1.7M intention nodes in source tree

**History:**
- Developed by Charles Simonyi at Microsoft Research (1991-2001)
- "The Death of Computer Languages, The Birth of Intentional Programming" (1995)
- Spun out as Intentional Software (2002)
- Acquired back by Microsoft (2017)

**References:**
- [Edge.org Interview](https://www.edge.org/conversation/charles_simonyi-intentional-programming)
- [Microsoft Research Paper](https://www.microsoft.com/en-us/research/publication/the-death-of-computer-languages-the-birth-of-intentional-programming/)
- [Intentional Programming (Wikipedia)](https://en.wikipedia.org/wiki/Intentional_programming)

**Why it didn't ship:**
1. **Strategic deprioritization**: Microsoft chose C#/.NET over IP in 2001 to counter Java
2. **Never finished**: Intentional Software ran 10+ years without shipping a product
3. **Adoption barrier**: Simonyi noted new languages "even more difficult to get adopted" — requires rewriting legacy AND changing skills
4. **Technical challenge**: Intent → code transformation hard to make reliable
5. **Not novel enough**: Language workbenches existed; not enough differentiation

**Lessons for mycelium:**
- Need a forcing function for adoption (LLMs might be it)
- Must ship incrementally — 10 years without product = death
- Graph → code must be reliable
- Consider interop with existing code vs requiring rewrite

---

## 8. Projectional Editors (JetBrains MPS)

Edit the AST directly, not text. No parsing.

**Key ideas:**
- Code is projection of AST, not text parsed into AST
- No parsing = no ambiguity when composing languages
- Mix notations freely: text, tables, diagrams, math
- Language workbench: define structure, editor, types, generators

**Notable projects built with MPS:**
- YouTrack (JetBrains issue tracker)
- mbeddr (embedded C with formal methods)

**References:**
- [JetBrains MPS](https://www.jetbrains.com/mps/)
- [Martin Fowler: A Language Workbench in Action](https://martinfowler.com/articles/mpsAgree.html)
- [MPS Wikipedia](https://en.wikipedia.org/wiki/JetBrains_MPS)

**Relevance to mycelium:** Projectional editing = graph is source, WAT is projection. Validates that AST-first editing works in production.

---

## 9. Bidirectional Transformations / Lenses

Programs that work forwards AND backwards.

**Key ideas:**
- Lens = bidirectional program with get (forward) and put (backward)
- Forward: concrete → abstract (loses some info)
- Backward: abstract + original concrete → new concrete
- Compositional: lenses compose into larger lenses

**Applications:**
- Parsers/pretty-printers
- Database views
- Schema evolution
- Configuration file transformers
- Software model transformations

**Notable systems:**
- **Boomerang** (UPenn) - lenses for string data
- **Augeas** - Linux config file management
- **Optician** - synthesizes bijective lenses

**References:**
- [Boomerang Project](https://www.seas.upenn.edu/~harmony/)
- [Bidirectional Transformation (Wikipedia)](https://en.wikipedia.org/wiki/Bidirectional_transformation)
- [Boomerang Paper (POPL 2008)](https://dl.acm.org/doi/10.1145/1328438.1328487)

**Relevance to mycelium:** Core technique for graph ↔ WAT bidirectionality. Lenses give formal foundations for roundtrip transformations.

---

## 10. Program Synthesis by Sketching (Sketch)

Partial programs with holes, filled by constraint solving.

**Key ideas:**
- Programmer writes sketch with holes (missing expressions)
- Synthesizer fills holes via SAT/SMT constraint solving
- CEGIS: Counterexample-Guided Inductive Synthesis
- Scaled to real programs (AES cipher, concurrent data structures)

**How it works:**
- Build constraints Q(x, c) where c is hole values
- Find c such that Q holds for all inputs x
- Use counterexamples to refine when synthesis fails

**References:**
- [Armando Solar-Lezama](https://people.csail.mit.edu/asolar/)
- [PhD Thesis: Program Synthesis by Sketching](https://people.csail.mit.edu/asolar/papers/thesis.pdf)
- [The Sketching Approach to Program Synthesis](https://people.csail.mit.edu/asolar/papers/Solar-Lezama09.pdf)

**Relevance to mycelium:** Sketch-like approach for filling implementation details from constraints. Human provides structure (sketch), system fills micro details.

---

## 11. Lightweight Formal Methods (Alloy, TLA+)

Specification languages with automated analysis.

### Alloy (Daniel Jackson, MIT)
- Declarative specs in relational logic
- Automatic model-finding via SAT
- "Small scope hypothesis": most bugs found with few objects
- Lightweight = practical for everyday use

### TLA+ (Leslie Lamport)
- Temporal logic for concurrent/distributed systems
- TLC model checker finds violations
- Used at AWS (DynamoDB, S3), Microsoft, Oracle
- "Exhaustively-testable pseudocode"

**References:**
- [Alloy](https://alloytools.org/)
- [TLA+ Home](https://lamport.azurewebsites.net/tla/tla.html)
- [Learn TLA+](https://learntla.com/)

**Relevance to mycelium:** Constraint validation via model-finding. Alloy's relational approach fits graph queries. TLA+ shows formal specs work at AWS scale.

---

## 12. Language-Oriented Programming (Racket)

Solve problems by creating domain-specific languages.

**Key ideas:**
- Build a language for your domain, write program in it
- Macros extend the compiler
- Any syntax can map to AST (not just S-expressions)
- Languages are libraries, compose freely

**References:**
- [Racket](https://racket-lang.org/)
- [Beautiful Racket](https://beautifulracket.com/)
- [From Macros to DSLs: The Evolution of Racket](https://cs.brown.edu/~sk/Publications/Papers/Published/cffk-macros-to-dsls/paper.pdf)

**Relevance to mycelium:** DSL mindset - define the right abstraction layer. Racket proves languages-as-libraries works.

---

## 13. Relational Programming (Eve)

Relational/Datalog core for general programming.

**Key ideas:**
- Temporal logic + relational datastore as foundation
- Literate programming environment (browser-based)
- Based on Dedalus/Datalog
- 30+ iterations exploring the design space

**History:**
- Founded by Chris Granger (LightTable) in 2013
- $2.3M from Andreessen Horowitz
- Shut down 2018

**References:**
- [Two Years of Eve](https://chris-granger.com/2016/07/21/two-years-of-eve/)
- [A Visual History of Eve](https://futureofcoding.org/essays/eve/)

**Relevance to mycelium:** Relational/graph core aligns with our model. Eve's exploration (30+ iterations) documents the design space.

---

## 14. Holistic Environments (Dark)

Language + editor + infrastructure as one.

**Key ideas:**
- "Deployless" - no separate deploy step (50ms deploys)
- Structured editor prevents invalid syntax
- Language, editor, infrastructure designed together
- Built for backends (APIs, services)

**References:**
- [Dark](https://darklang.com/)
- [TechCrunch: Dark emerges from stealth](https://techcrunch.com/2019/07/29/dark-emerges-from-stealth-with-unique-deployless-software-model/)
- [Future of Coding: Unveiling Dark](https://futureofcoding.org/episodes/043.html)

**Relevance to mycelium:** Holistic design (language + tools + runtime). Structured editing prevents invalid states. Proves integrated approach viable.

---

## 15. Live Programming with Holes (Hazel)

Incomplete programs that typecheck and run.

**Key ideas:**
- Typed holes for missing expressions
- Programs with holes still typecheck and execute
- Hole closures track evaluation context
- Integrates LLM synthesis for hole-filling

**Awards:**
- Distinguished Paper at POPL 2024
- Distinguished Paper at OOPSLA 2023

**References:**
- [Hazel](https://hazel.org/)
- [GitHub: hazelgrove/hazel](https://github.com/hazelgrove/hazel)
- [Live Functional Programming with Typed Holes](https://dl.acm.org/doi/10.1145/3290327)

**Relevance to mycelium:** Holes = incomplete graph nodes waiting for synthesis. Live execution even when incomplete. LLM integration research directly applicable.

---

## 16. Example-Centric Programming (Subtext)

Program representation IS execution.

**Key ideas:**
- Like a spreadsheet - always live, always executing
- Edits are semantic transformations, not text changes
- Copying as fundamental operation
- Program visible and alive as edited

**References:**
- [Subtext](https://www.subtext-lang.org/)
- [Subtext: Uncovering the Simplicity of Programming (OOPSLA 2005)](https://www.subtext-lang.org/OOPSLA05.pdf)
- [Alarming Development (blog)](https://alarmingdevelopment.org/)

**Relevance to mycelium:** Live execution vision. Graph changes = immediate visible effects. Semantic edits not text edits.

---

## Key Patterns Across Prior Art

| Pattern | Systems | Relevance |
|---------|---------|-----------|
| Graph/block → code | Simulink, SCADE, LabVIEW, MDA | Core thesis |
| Intent as primary | Intentional Programming, MDA | Graph is source of truth |
| Bidirectional | Lenses/Boomerang | Graph ↔ code |
| Holes/sketches | Sketch, Hazel | Partial specs, synthesize rest |
| Projectional editing | MPS, Dark | AST is source, not text |
| Constraint solving | Sketch, Alloy | SAT/SMT for synthesis |
| Formal specs | TLA+, Alloy, Lustre | Verify before commit |
| Content-addressed | Unison | No dependency hell |
| Live execution | Hazel, Subtext, Eve | Always running |
| Holistic | Dark, MPS | Language + editor + runtime |
| Neuro + symbolic | Program synthesis | LLMs + graphs |

---

## What's Different About Mycelium

Prior art largely focused on:
- Domain-specific (embedded, control systems)
- Visual-first (drag and drop blocks)
- Single direction (model → code)
- New languages (adoption barrier)

Mycelium aims for:
- General-purpose (via WAT/WASM)
- Dual-mode (words + graphs, not just visual)
- Bidirectional (graph ↔ code)
- AI as peer (not just code generator)
- Constraints as first-class citizens
- Recursive box model (same structure at all levels)
- **NOT a new language** — graph is the abstraction, outputs are existing languages (WAT, TS, Rust, etc.)
