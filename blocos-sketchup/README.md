# Blocos 3D de ferragens para SketchUp

Modelos em escala real (milímetros, eixo Z para cima) dos itens do painel
"Pequenos reparos sem sair de casa":

| Arquivo (slug)                   | Item                              | Dimensões aprox. |
|----------------------------------|-----------------------------------|------------------|
| `fita_isolante_19mm`             | Rolo de fita isolante preta, núcleo de papelão, ponta descolada | Ø70 × 19 mm |
| `fita_veda_rosca_18mm`           | Fita veda-rosca branca em carretel plástico | Ø49 × 20 mm |
| `prego_17x27_3_0_x_62mm`         | Prego 17×27 (aço escuro)          | Ø3 × 62 mm |
| `parafuso_4_0_x_40mm_phillips`   | Parafuso para madeira, cabeça chata Phillips, bicromatizado, rosca real | Ø8 × 40 mm |
| `bucha_nylon_6mm`                | Bucha de nylon 6 mm com colarinho, fendas e aletas | Ø8 × 30 mm |
| `porca_sextavada_m6`             | Porca sextavada M6                | 10 mm entre faces × 5 mm |
| `arruela_lisa_m6`                | Arruela lisa M6                   | Ø12,5 × 1,6 mm |

`preview.png` mostra todos os itens renderizados.

## Como levar para o SketchUp

Há três caminhos. Use o que combinar com a sua versão.

### 1. Script Ruby (recomendado, qualquer SketchUp desktop: Make, Pro, Studio)

Cria um **componente por item**, já com materiais coloridos e arestas
suavizadas, direto no modelo aberto.

1. Copie `sketchup-ruby/blocos_ferragens.rb` para uma pasta sem acentos
   (ex.: `C:/blocos/`).
2. No SketchUp: **Janela › Console Ruby** (Window › Ruby Console).
3. Cole e dê Enter:

```ruby
load "C:/blocos/blocos_ferragens.rb"
```

Os sete componentes aparecem em linha na origem. Depois é só arrastar do
painel **Componentes** para o projeto. Para salvar como biblioteca:
clique com o botão direito no componente › *Salvar como…* (.skp).

### 2. Importar DAE / Collada (SketchUp Make, Pro, Studio)

**Arquivo › Importar**, tipo *COLLADA (*.dae)*. Em *Opções*, marque
*Mesclar faces coplanares*. A unidade (milímetro) já vem dentro do arquivo.

- `dae/<item>.dae` importa um item por vez (vira um componente).
- `dae/todos_os_blocos.dae` importa os sete de uma vez, lado a lado.

Se as faces ficarem facetadas: selecione tudo › botão direito › *Suavizar/
Amaciar arestas* (Soften/Smooth Edges) com uns 35°.

### 3. OBJ ou STL

- **OBJ** (`obj/`): SketchUp Pro importa nativamente (Arquivo › Importar ›
  OBJ). Na opção de unidades escolha **milímetros**. O `.mtl` ao lado traz
  as cores.
- **STL** (`stl/`): SketchUp 2018+ importa nativamente; SketchUp Free (web)
  também aceita STL. Não carrega cor; pinte depois com o balde de tinta.
  Importe em **milímetros**.

## Regerar ou ajustar medidas

Todas as dimensões estão no início de cada função em `gerar_blocos.py`
(ex.: trocar o parafuso 4,0 × 40 por 5,0 × 50, ou a fita de 19 para 25 mm).

```bash
pip install numpy trimesh scipy networkx matplotlib
python3 gerar_blocos.py
```

## Peso dos modelos

| Item | Triângulos |
|------|-----------:|
| Parafuso (rosca real) | ~6 700 |
| Fita veda-rosca | ~1 500 |
| Bucha | ~1 200 |
| Fita isolante | ~1 200 |
| Prego, porca, arruela | ~400 cada |

O parafuso é o mais pesado por causa da rosca helicoidal. Se for espalhar
centenas deles num projeto, reduza `n=32` e `rows_per_pitch=6` dentro de
`parafuso()` ou use apenas alguns em primeiro plano.
