# Itens de saúde e higiene pessoal para a gôndola (SketchUp)

Dezenove blocos em escala real (milímetros, Z para cima), com materiais:

| Arquivo (slug) | Item | Tamanho aprox. (mm) |
|---|---|---|
| `creme_dental_caixa` | Cartucho de creme dental (branco com faixa vermelha) | 38 × 28 × 165 |
| `creme_dental_tubo` | Tubo de creme dental, em pé sobre a tampa | 50 × 35 × 168 |
| `escova_dental` | Escova dental, cabo verde, cerdas brancas e azuis | 19 × 16 × 192 |
| `escova_dental_embalagem` | Escova dentro da cartela com bolha transparente | 62 × 23 × 228 |
| `sabonete_barra` | Sabonete em barra 90 g | 90 × 60 × 25 |
| `sabonete_caixa` | Cartucho de sabonete | 95 × 65 × 30 |
| `shampoo_350ml` | Frasco de shampoo com tampa flip | 66 × 44 × 190 |
| `condicionador_350ml` | Idem, rosa | 66 × 44 × 190 |
| `desodorante_aerosol` | Lata prata com tampa azul | Ø53 × 186 |
| `desodorante_roll_on` | Frasco branco com tampa roxa | 46 × 34 × 140 |
| `absorventes_pacote` | Pacote macio rosa com faixa branca | 125 × 81 × 70 |
| `curativos_caixa` | Caixa de curativos adesivos, em pé | 95 × 22 × 60 |
| `curativo_adesivo` | Curativo solto, com gaze | 76 × 19 × 2 |
| `algodao_pacote` | Pacote de algodão com faixa azul | 121 × 71 × 55 |
| `alcool_em_gel_500ml` | Frasco translúcido com válvula pump | Ø70 × 196 |
| `papel_higienico_rolo` | Rolo com tubete de papelão | Ø110 × 100 |
| `papel_higienico_fardo_4_rolos` | Fardo 2 × 2 com plástico translúcido e rótulo | 225 × 225 × 106 |
| `lencos_de_papel_caixa` | Caixa de lenços com abertura e lenço saindo | 220 × 110 × 93 |
| `lencos_de_papel_bolso` | Pacote de bolso | 105 × 55 × 24 |

Todos têm entre 40 e 4.700 triângulos (o fardo de papel é o maior), leves
para repetir muitas vezes na gôndola. `preview_higiene.png` mostra todos.

## Como usar no SketchUp

**Script Ruby (recomendado):** copie `sketchup-ruby/itens_higiene.rb` para
uma pasta sem acentos e, em *Janela › Console Ruby*:

```ruby
load "C:/blocos/itens_higiene.rb"
```

Cria um componente por item, em linha na origem, com materiais e arestas
suavizadas. Depois é só arrastar do painel *Componentes* para as
prateleiras e copiar quantas vezes precisar.

**DAE:** *Arquivo › Importar › COLLADA*, um arquivo por item ou
`todos_os_itens_higiene.dae` com todos. Unidade já em milímetros.

**OBJ / STL:** importe em milímetros. O STL não carrega cor.

## Ajustar

Medidas e cores ficam no início de cada função em `gerar_higiene.py`
(por exemplo, trocar a faixa vermelha do creme dental por azul, ou fazer o
shampoo de 500 ml). Depois:

```bash
python3 gerar_higiene.py
```
